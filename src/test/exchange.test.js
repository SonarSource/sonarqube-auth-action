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
import { describe, it } from "node:test";
import { exchangeToken } from "../main/exchange.js";

const REQUEST = {
  endpoint: "https://api.sonarcloud.io/authentication/token",
  audience: "https://sonarcloud.io",
  subjectToken: "github-oidc-jwt",
};

const SUCCESS_BODY = {
  access_token: "sqco_secret",
  organization: "acme",
  project_key: "acme_app",
  expires_in: 1800,
};

function reply(status, body) {
  return { status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) };
}

function scriptedFetch(...steps) {
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push({ url, options });
    const step = steps[Math.min(calls.length, steps.length) - 1];
    if (step instanceof Error) {
      throw step;
    }
    return step;
  };
  return { fetchFn, calls };
}

function recordedSleep() {
  const delays = [];
  return { sleepFn: async (ms) => delays.push(ms), delays };
}

describe("exchangeToken", () => {
  it("posts the RFC 8693 form and returns the token and coordinates", async () => {
    const { fetchFn, calls } = scriptedFetch(reply(200, SUCCESS_BODY));

    const result = await exchangeToken(REQUEST, { fetchFn });

    assert.deepEqual(result, {
      accessToken: "sqco_secret",
      organization: "acme",
      projectKey: "acme_app",
      expiresIn: 1800,
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, REQUEST.endpoint);
    assert.equal(calls[0].options.method, "POST");
    assert.equal(calls[0].options.headers["Content-Type"], "application/x-www-form-urlencoded");
    assert.deepEqual(Object.fromEntries(calls[0].options.body), {
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: "github-oidc-jwt",
      subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
      audience: "https://sonarcloud.io",
    });
  });

  it("sends the project key when given", async () => {
    const { fetchFn, calls } = scriptedFetch(reply(200, SUCCESS_BODY));

    await exchangeToken({ ...REQUEST, projectKey: "acme_app" }, { fetchFn });

    assert.equal(calls[0].options.body.get("project_key"), "acme_app");
  });

  it("omits the project key when empty", async () => {
    const { fetchFn, calls } = scriptedFetch(reply(200, SUCCESS_BODY));

    await exchangeToken({ ...REQUEST, projectKey: "" }, { fetchFn });

    assert.equal(calls[0].options.body.has("project_key"), false);
  });

  it("explains how to fix a project key that matches no bound project", async () => {
    const { fetchFn } = scriptedFetch(reply(404, { error: "invalid_grant", error_description: "Unknown project key" }));

    await assert.rejects(
      exchangeToken({ ...REQUEST, projectKey: "acme_other" }, { fetchFn }),
      /project key 'acme_other' does not match any SonarQube Cloud project bound to this repository \(Unknown project key\).*project-key input/,
    );
  });

  it("tolerates a response without optional fields", async () => {
    const { fetchFn } = scriptedFetch(reply(200, { access_token: "sqco_secret" }));

    const result = await exchangeToken(REQUEST, { fetchFn });

    assert.deepEqual(result, { accessToken: "sqco_secret", organization: "", projectKey: "", expiresIn: undefined });
  });

  it("fails when the response has no access_token", async () => {
    const { fetchFn } = scriptedFetch(reply(200, { organization: "acme" }));

    await assert.rejects(exchangeToken(REQUEST, { fetchFn }), /contains no access_token/);
  });

  it("explains how to fix an organization that has not enabled trusted scanning", async () => {
    const { fetchFn, calls } = scriptedFetch(
      reply(403, { error: "access_denied", error_description: "not enabled for this organization" }),
    );

    await assert.rejects(
      exchangeToken(REQUEST, { fetchFn }),
      /Access denied: not enabled for this organization.*administrator.*enable trusted scanning/,
    );
    assert.equal(calls.length, 1);
  });

  it("explains how to fix a repository that is not bound to a project", async () => {
    const { fetchFn } = scriptedFetch(
      reply(404, { error: "invalid_grant", error_description: "Repository not bound to a SonarCloud project" }),
    );

    await assert.rejects(exchangeToken(REQUEST, { fetchFn }), /not bound to a SonarQube Cloud project.*Repository not bound/);
  });

  it("reports a rejected OIDC token", async () => {
    const { fetchFn } = scriptedFetch(reply(401, { error: "invalid_grant", error_description: "JWT expired" }));

    await assert.rejects(exchangeToken(REQUEST, { fetchFn }), /rejected the GitHub OIDC token: JWT expired/);
  });

  it("reports other client errors with their status", async () => {
    const { fetchFn } = scriptedFetch(reply(400, { error: "invalid_target" }));

    await assert.rejects(exchangeToken(REQUEST, { fetchFn }), /HTTP 400: invalid_target/);
  });

  it("copes with a non-JSON error body", async () => {
    const { fetchFn } = scriptedFetch(reply(400, "<html>Bad Request</html>"));

    await assert.rejects(exchangeToken(REQUEST, { fetchFn }), /HTTP 400: no details provided/);
  });

  it("retries on 5xx with increasing delays, then succeeds", async () => {
    const { fetchFn, calls } = scriptedFetch(reply(503, {}), reply(500, {}), reply(200, SUCCESS_BODY));
    const { sleepFn, delays } = recordedSleep();
    const logs = [];

    const result = await exchangeToken(REQUEST, { fetchFn, sleepFn, log: (message) => logs.push(message) });

    assert.equal(result.accessToken, "sqco_secret");
    assert.equal(calls.length, 3);
    assert.deepEqual(delays, [1000, 2000]);
    assert.equal(logs.length, 2);
  });

  it("retries on network errors", async () => {
    const { fetchFn, calls } = scriptedFetch(new TypeError("fetch failed"), reply(200, SUCCESS_BODY));
    const { sleepFn } = recordedSleep();

    const result = await exchangeToken(REQUEST, { fetchFn, sleepFn });

    assert.equal(result.accessToken, "sqco_secret");
    assert.equal(calls.length, 2);
  });

  it("gives up after three attempts", async () => {
    const { fetchFn, calls } = scriptedFetch(reply(502, {}));
    const { sleepFn } = recordedSleep();

    await assert.rejects(exchangeToken(REQUEST, { fetchFn, sleepFn }), /unreachable or unavailable \(HTTP 502\) after 3 attempts/);
    assert.equal(calls.length, 3);
  });

  it("does not retry client errors", async () => {
    const { fetchFn, calls } = scriptedFetch(reply(403, {}));

    await assert.rejects(exchangeToken(REQUEST, { fetchFn }));
    assert.equal(calls.length, 1);
  });
});
