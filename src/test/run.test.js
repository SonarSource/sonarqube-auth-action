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
import { afterEach, beforeEach, describe, it } from "node:test";
import { run } from "../main/run.js";

function fakeCore(inputs = {}) {
  const state = { outputs: {}, env: {}, secrets: [], infos: [], debugs: [], failure: undefined, idTokenAudiences: [], summaryWrites: 0 };
  const summary = {
    addHeading: () => summary,
    addTable: () => summary,
    write: async () => {
      state.summaryWrites++;
    },
  };
  const core = {
    getInput: (name) => inputs[name] ?? "",
    getBooleanInput: (name) => (inputs[name] ?? "true") === "true",
    getIDToken: async (audience) => {
      state.idTokenAudiences.push(audience);
      return "github-oidc-jwt";
    },
    setSecret: (value) => state.secrets.push(value),
    setOutput: (name, value) => {
      state.outputs[name] = value;
    },
    exportVariable: (name, value) => {
      state.env[name] = value;
    },
    info: (message) => state.infos.push(message),
    debug: (message) => state.debugs.push(message),
    setFailed: (message) => {
      state.failure = message;
    },
    summary,
  };
  return { core, state };
}

function replyingWith(status, body) {
  const calls = [];
  const fetchFn = async (url, options) => {
    calls.push({ url, options });
    return { status, text: async () => JSON.stringify(body) };
  };
  return { fetchFn, calls };
}

const SUCCESS_BODY = { access_token: "sqco_secret", organization: "acme", project_key: "acme_app", expires_in: 1800 };

describe("run", () => {
  let previousUrl;

  beforeEach(() => {
    previousUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    process.env.ACTIONS_ID_TOKEN_REQUEST_URL = "https://pipelines.actions.githubusercontent.com/token";
  });

  afterEach(() => {
    if (previousUrl === undefined) {
      delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    } else {
      process.env.ACTIONS_ID_TOKEN_REQUEST_URL = previousUrl;
    }
  });

  it("exchanges the token for the default host and exports the environment", async () => {
    const { core, state } = fakeCore();
    const { fetchFn, calls } = replyingWith(200, SUCCESS_BODY);

    await run(core, { fetchFn });

    assert.equal(state.failure, undefined);
    assert.deepEqual(state.idTokenAudiences, ["https://sonarcloud.io"]);
    assert.equal(calls[0].url, "https://api.sonarcloud.io/authentication/token");
    assert.deepEqual(state.outputs, {
      "sonar-token": "sqco_secret",
      organization: "acme",
      "project-key": "acme_app",
    });
    assert.deepEqual(state.env, { SONAR_TOKEN: "sqco_secret" });
    assert.ok(state.secrets.includes("sqco_secret"));
    assert.equal(state.summaryWrites, 1);
  });

  it("never prints the token", async () => {
    const { core, state } = fakeCore();
    const { fetchFn } = replyingWith(200, SUCCESS_BODY);

    await run(core, { fetchFn });

    assert.ok(state.infos.length > 0);
    assert.ok(state.infos.every((message) => !message.includes("sqco_secret")));
  });

  it("reports the validity only when the server returns an expiry", async () => {
    const withExpiry = fakeCore();
    await run(withExpiry.core, { fetchFn: replyingWith(200, SUCCESS_BODY).fetchFn });

    const withoutExpiry = fakeCore();
    await run(withoutExpiry.core, { fetchFn: replyingWith(200, { ...SUCCESS_BODY, expires_in: undefined }).fetchFn });

    assert.ok(withExpiry.state.infos.includes("Obtained a SonarQube token for organization 'acme' and project 'acme_app', valid for 30 minutes."));
    assert.ok(withoutExpiry.state.infos.includes("Obtained a SonarQube token for organization 'acme' and project 'acme_app'."));
    assert.equal(withoutExpiry.state.failure, undefined);
  });

  it("targets the region given as input and exports it", async () => {
    const { core, state } = fakeCore({ "sonar-region": "us" });
    const { fetchFn, calls } = replyingWith(200, SUCCESS_BODY);

    await run(core, { fetchFn });

    assert.deepEqual(state.idTokenAudiences, ["https://sonarqube.us"]);
    assert.equal(calls[0].url, "https://api.sonarqube.us/authentication/token");
    assert.deepEqual(state.env, { SONAR_TOKEN: "sqco_secret", SONAR_REGION: "us" });
  });

  it("targets the custom URLs given as input and exports them", async () => {
    const { core, state } = fakeCore({ "sonar-web-base-url": "https://dev5.sc-dev5.io", "sonar-api-base-url": "https://api.sc-dev5.io" });
    const { fetchFn, calls } = replyingWith(200, SUCCESS_BODY);

    await run(core, { fetchFn });

    assert.deepEqual(state.idTokenAudiences, ["https://dev5.sc-dev5.io"]);
    assert.equal(calls[0].url, "https://api.sc-dev5.io/authentication/token");
    assert.deepEqual(state.env, {
      SONAR_TOKEN: "sqco_secret",
      SONAR_SCANNER_SONARCLOUD_URL: "https://dev5.sc-dev5.io",
      SONAR_SCANNER_API_BASE_URL: "https://api.sc-dev5.io",
    });
  });

  it("does not export the environment when export-env is false", async () => {
    const { core, state } = fakeCore({ "export-env": "false" });
    const { fetchFn } = replyingWith(200, SUCCESS_BODY);

    await run(core, { fetchFn });

    assert.deepEqual(state.env, {});
    assert.equal(state.outputs["sonar-token"], "sqco_secret");
    assert.ok(state.secrets.includes("sqco_secret"));
  });

  it("fails with the id-token hint when the job has no OIDC permission", async () => {
    delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
    const { core, state } = fakeCore();
    const { fetchFn, calls } = replyingWith(200, SUCCESS_BODY);

    await run(core, { fetchFn });

    assert.match(state.failure, /permissions: id-token: write/);
    assert.match(state.failure, /forks/);
    assert.equal(calls.length, 0);
    assert.deepEqual(state.env, {});
  });

  it("fails on an unsupported region without contacting anything", async () => {
    const { core, state } = fakeCore({ "sonar-region": "mars" });
    const { fetchFn, calls } = replyingWith(200, SUCCESS_BODY);

    await run(core, { fetchFn });

    assert.match(state.failure, /Unsupported sonar-region/);
    assert.equal(calls.length, 0);
    assert.deepEqual(state.idTokenAudiences, []);
  });

  it("fails with the server explanation when the exchange is denied", async () => {
    const { core, state } = fakeCore();
    const { fetchFn } = replyingWith(403, { error: "access_denied", error_description: "not enabled" });

    await run(core, { fetchFn });

    assert.match(state.failure, /Access denied: not enabled/);
    assert.deepEqual(state.outputs, {});
    assert.deepEqual(state.env, {});
  });

  it("still succeeds when the job summary cannot be written", async () => {
    const { core, state } = fakeCore();
    core.summary.write = async () => {
      throw new Error("no summary file");
    };
    const { fetchFn } = replyingWith(200, SUCCESS_BODY);

    await run(core, { fetchFn });

    assert.equal(state.failure, undefined);
    assert.match(state.debugs[0], /no summary file/);
  });
});
