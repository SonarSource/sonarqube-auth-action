// SonarQube Auth Action
// Copyright (C) SonarSource Sàrl
// mailto:info AT sonarsource DOT com
//
// This program is free software; you can redistribute it and/or
// modify it under the terms of the GNU Lesser General Public
// License as published by the Free Software Foundation; either
// version 3 of the License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
// Lesser General Public License for more details.
//
// You should have received a copy of the GNU Lesser General Public License
// along with this program; if not, write to the Free Software Foundation,
// Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.

import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { afterEach, beforeEach, describe, it } from "node:test";
import { exchangeToken } from "../main/exchange.js";

const PROXY_VARIABLES = ["http_proxy", "HTTP_PROXY", "https_proxy", "HTTPS_PROXY", "no_proxy", "NO_PROXY"];
const UNRESOLVABLE_HOST = "sonar-auth-action.invalid";
const SUCCESS_BODY = { access_token: "sqco_secret", organization: "acme", project_key: "acme_app", expires_in: 1800 };

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

function close(server) {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

async function startStub() {
  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      requests.push({ method: request.method, url: request.url, contentType: request.headers["content-type"], body: Buffer.concat(chunks).toString() });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(SUCCESS_BODY));
    });
  });
  const port = await listen(server);
  return { server, port, requests };
}

async function startProxy(targetPort) {
  const connects = [];
  const server = http.createServer((request, response) => {
    response.writeHead(405);
    response.end();
  });
  server.on("connect", (request, clientSocket, head) => {
    connects.push(request.url);
    const upstream = net.connect(targetPort, "127.0.0.1", () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    const teardown = () => {
      upstream.destroy();
      clientSocket.destroy();
    };
    upstream.on("error", teardown);
    clientSocket.on("error", teardown);
  });
  const port = await listen(server);
  return { server, port, connects };
}

function request(endpoint) {
  return { endpoint, audience: "https://sonarcloud.io", subjectToken: "github-oidc-jwt" };
}

describe("exchangeToken with the default HTTP client", () => {
  let saved;
  let stub;
  let proxy;

  beforeEach(async () => {
    saved = Object.fromEntries(PROXY_VARIABLES.map((name) => [name, process.env[name]]));
    PROXY_VARIABLES.forEach((name) => delete process.env[name]);
    stub = await startStub();
    proxy = await startProxy(stub.port);
  });

  afterEach(async () => {
    PROXY_VARIABLES.forEach((name) => {
      if (saved[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = saved[name];
      }
    });
    await close(proxy.server);
    await close(stub.server);
  });

  it("sends the exchange through the proxy configured in the environment", async () => {
    process.env.http_proxy = `http://127.0.0.1:${proxy.port}`;
    const endpoint = `http://${UNRESOLVABLE_HOST}:${stub.port}/authentication/token`;

    const result = await exchangeToken(request(endpoint), { sleepFn: async () => {} });

    assert.equal(result.accessToken, "sqco_secret");
    assert.deepEqual(proxy.connects, [`${UNRESOLVABLE_HOST}:${stub.port}`]);
    assert.equal(stub.requests.length, 1);
    assert.equal(stub.requests[0].method, "POST");
    assert.equal(stub.requests[0].url, "/authentication/token");
    assert.equal(stub.requests[0].contentType, "application/x-www-form-urlencoded");
    const form = new URLSearchParams(stub.requests[0].body);
    assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:token-exchange");
    assert.equal(form.get("subject_token"), "github-oidc-jwt");
    assert.equal(form.get("subject_token_type"), "urn:ietf:params:oauth:token-type:id_token");
    assert.equal(form.get("audience"), "https://sonarcloud.io");
  });

  it("honors the upper case proxy variable", async () => {
    process.env.HTTP_PROXY = `http://127.0.0.1:${proxy.port}`;
    const endpoint = `http://${UNRESOLVABLE_HOST}:${stub.port}/authentication/token`;

    await exchangeToken(request(endpoint), { sleepFn: async () => {} });

    assert.equal(proxy.connects.length, 1);
  });

  it("skips the proxy for hosts listed in no_proxy", async () => {
    process.env.http_proxy = `http://127.0.0.1:${proxy.port}`;
    process.env.no_proxy = "localhost,.internal.example";
    const endpoint = `http://localhost:${stub.port}/authentication/token`;

    const result = await exchangeToken(request(endpoint), { sleepFn: async () => {} });

    assert.equal(result.accessToken, "sqco_secret");
    assert.deepEqual(proxy.connects, []);
    assert.equal(stub.requests.length, 1);
  });

  it("connects directly when no proxy is configured", async () => {
    const endpoint = `http://127.0.0.1:${stub.port}/authentication/token`;

    const result = await exchangeToken(request(endpoint), { sleepFn: async () => {} });

    assert.equal(result.organization, "acme");
    assert.deepEqual(proxy.connects, []);
  });

  it("retries a failing connection and then reports the service as unreachable", async () => {
    const delays = [];
    const closedPort = stub.port;
    await close(stub.server);
    const endpoint = `http://127.0.0.1:${closedPort}/authentication/token`;

    await assert.rejects(
      exchangeToken(request(endpoint), { sleepFn: async (ms) => delays.push(ms) }),
      /unreachable or unavailable .* after 3 attempts/,
    );
    assert.deepEqual(delays, [1000, 2000]);
    stub.server = http.createServer();
  });
});
