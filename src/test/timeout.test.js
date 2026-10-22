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
import { exchangeToken, proxyAwareFetch } from "../main/exchange.js";

const SHORT_TIMEOUT_MS = 300;
const TEST_TIMEOUT_MS = 10000;
const SETTLE_MS = 100;
const PROXY_VARIABLES = ["http_proxy", "HTTP_PROXY", "https_proxy", "HTTPS_PROXY", "no_proxy", "NO_PROXY"];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const REQUEST = { headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ a: "b" }) };

function startServer(handler) {
  const sockets = [];
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    request.resume();
    handler(request, response);
  });
  server.on("connection", (socket) => sockets.push(socket));
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ server, sockets, requests, url: `http://127.0.0.1:${server.address().port}/token` })),
  );
}

function stopServer({ server, sockets }) {
  sockets.forEach((socket) => socket.destroy());
  return new Promise((resolve) => server.close(() => resolve()));
}


function startProxy({ targetPort, stallConnect = false }) {
  const clientSockets = [];
  const connects = [];
  const server = http.createServer((request, response) => {
    response.writeHead(405);
    response.end();
  });
  server.on("connect", (request, clientSocket, head) => {
    clientSockets.push(clientSocket);
    connects.push(request.url);
    clientSocket.on("error", () => {});
    clientSocket.on("end", () => {
      clientSocket.peerClosed = true;
    });
    clientSocket.on("close", () => {
      clientSocket.peerClosed = true;
    });
    if (stallConnect) {
      return;
    }
    const upstream = net.connect(targetPort, "127.0.0.1", () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    upstream.on("error", () => clientSocket.destroy());
    clientSocket.on("close", () => upstream.destroy());
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve({ server, clientSockets, connects, url: `http://127.0.0.1:${server.address().port}` })),
  );
}

const UNRESOLVABLE_URL = (port) => `http://sonar-auth-action.invalid:${port}/token`;

const stallAfterHeaders = (request, response) => {
  response.writeHead(200, { "Content-Type": "application/json", "Content-Length": "1000" });
  response.write("{");
};

const resetMidBody = (request, response) => {
  response.writeHead(200, { "Content-Type": "application/json", "Content-Length": "1000" });
  response.write("{");
  setTimeout(() => response.socket.destroy(), 20);
};

describe("the default HTTP client deadline", () => {
  let saved;
  let running;

  beforeEach(() => {
    saved = Object.fromEntries(PROXY_VARIABLES.map((name) => [name, process.env[name]]));
    PROXY_VARIABLES.forEach((name) => delete process.env[name]);
  });

  afterEach(async () => {
    PROXY_VARIABLES.forEach((name) => {
      if (saved[name] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = saved[name];
      }
    });
    await stopServer(running);
  });

  it("gives up when the server stalls after sending the headers", { timeout: TEST_TIMEOUT_MS }, async () => {
    running = await startServer(stallAfterHeaders);

    await assert.rejects(proxyAwareFetch(running.url, REQUEST, SHORT_TIMEOUT_MS), /timed out after 300 ms/);
  });

  it("fails instead of hanging when the connection is reset in the middle of the body", { timeout: TEST_TIMEOUT_MS }, async () => {
    running = await startServer(resetMidBody);

    await assert.rejects(proxyAwareFetch(running.url, REQUEST, SHORT_TIMEOUT_MS), Error);
  });

  it("closes its sockets so the process can exit after a timeout", { timeout: TEST_TIMEOUT_MS }, async () => {
    running = await startServer(stallAfterHeaders);

    await assert.rejects(proxyAwareFetch(running.url, REQUEST, SHORT_TIMEOUT_MS));
    await sleep(SETTLE_MS);

    assert.ok(running.sockets.length > 0);
    assert.ok(running.sockets.every((socket) => socket.destroyed));
  });

  it("lets the exchange retry a stalled response and then report the service as unavailable", { timeout: TEST_TIMEOUT_MS }, async () => {
    running = await startServer(stallAfterHeaders);
    const request = { endpoint: running.url, audience: "https://sonarcloud.io", subjectToken: "jwt" };

    await assert.rejects(
      exchangeToken(request, {
        fetchFn: (url, options) => proxyAwareFetch(url, options, SHORT_TIMEOUT_MS),
        sleepFn: async () => {},
      }),
      /unreachable or unavailable .* after 3 attempts/,
    );
    assert.equal(running.requests.length, 3);
  });

  it("closes the proxy connection when the proxy never answers the CONNECT request", { timeout: TEST_TIMEOUT_MS }, async () => {
    running = await startServer(stallAfterHeaders);
    const stubPort = Number(new URL(running.url).port);
    const proxy = await startProxy({ targetPort: stubPort, stallConnect: true });
    process.env.http_proxy = proxy.url;

    try {
      await assert.rejects(proxyAwareFetch(UNRESOLVABLE_URL(stubPort), REQUEST, SHORT_TIMEOUT_MS), /timed out after 300 ms/);
      await sleep(SETTLE_MS);

      assert.equal(proxy.connects.length, 1);
      assert.ok(proxy.clientSockets.every((socket) => socket.peerClosed));
    } finally {
      await stopServer({ server: proxy.server, sockets: proxy.clientSockets });
    }
  });

  it("closes the proxy tunnel when the response stalls inside it", { timeout: TEST_TIMEOUT_MS }, async () => {
    running = await startServer(stallAfterHeaders);
    const proxy = await startProxy({ targetPort: Number(new URL(running.url).port) });
    process.env.http_proxy = proxy.url;

    try {
      await assert.rejects(proxyAwareFetch(UNRESOLVABLE_URL(new URL(running.url).port), REQUEST, SHORT_TIMEOUT_MS), /timed out after 300 ms/);
      await sleep(SETTLE_MS);

      assert.equal(proxy.connects.length, 1);
      assert.equal(running.requests.length, 1);
      assert.ok(proxy.clientSockets.every((socket) => socket.destroyed));
      assert.ok(running.sockets.every((socket) => socket.destroyed));
    } finally {
      await stopServer({ server: proxy.server, sockets: proxy.clientSockets });
    }
  });

  it("retries through the proxy and reports the service as unavailable when every attempt stalls", { timeout: TEST_TIMEOUT_MS }, async () => {
    running = await startServer(stallAfterHeaders);
    const proxy = await startProxy({ targetPort: Number(new URL(running.url).port) });
    process.env.http_proxy = proxy.url;
    const request = { endpoint: UNRESOLVABLE_URL(new URL(running.url).port), audience: "https://sonarcloud.io", subjectToken: "jwt" };

    try {
      await assert.rejects(
        exchangeToken(request, { fetchFn: (url, options) => proxyAwareFetch(url, options, SHORT_TIMEOUT_MS), sleepFn: async () => {} }),
        /unreachable or unavailable .* after 3 attempts/,
      );
      await sleep(SETTLE_MS);

      assert.equal(proxy.connects.length, 3);
      assert.ok(proxy.clientSockets.every((socket) => socket.destroyed));
    } finally {
      await stopServer({ server: proxy.server, sockets: proxy.clientSockets });
    }
  });

  it("still returns a response that arrives in time", { timeout: TEST_TIMEOUT_MS }, async () => {
    running = await startServer((request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    });

    const result = await proxyAwareFetch(running.url, REQUEST, SHORT_TIMEOUT_MS);

    assert.equal(result.status, 200);
    assert.deepEqual(JSON.parse(await result.text()), { ok: true });
  });
});
