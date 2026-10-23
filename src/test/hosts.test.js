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
import { resolveTarget } from "../main/hosts.js";

describe("resolveTarget", () => {
  it("resolves no input to the EU instance without scanner environment", () => {
    assert.deepEqual(resolveTarget(), {
      webUrl: "https://sonarcloud.io",
      audience: "https://sonarcloud.io",
      endpoint: "https://api.sonarcloud.io/authentication/token",
      scannerEnv: {},
    });
  });

  it("resolves the explicit EU region without scanner environment", () => {
    assert.deepEqual(resolveTarget({ region: "eu" }).scannerEnv, {});
  });

  it("resolves the US region and sets SONAR_REGION", () => {
    assert.deepEqual(resolveTarget({ region: "us" }), {
      webUrl: "https://sonarqube.us",
      audience: "https://sonarqube.us",
      endpoint: "https://api.sonarqube.us/authentication/token",
      scannerEnv: { SONAR_REGION: "us" },
    });
  });

  it("ignores the case and surrounding whitespace of the region", () => {
    assert.equal(resolveTarget({ region: "  US " }).webUrl, "https://sonarqube.us");
  });

  it("rejects an unsupported region and lists the supported ones", () => {
    assert.throws(() => resolveTarget({ region: "mars" }), /Unsupported sonar-region 'mars'\. Supported regions: eu, us\./);
  });

  it("rejects a region name inherited from the object prototype", () => {
    assert.throws(() => resolveTarget({ region: "constructor" }), /Unsupported sonar-region/);
  });

  it("resolves custom URLs whose API host does not derive from the web host", () => {
    assert.deepEqual(resolveTarget({ webBaseUrl: "https://dev5.sc-dev5.io/", apiBaseUrl: "https://api.sc-dev5.io/" }), {
      webUrl: "https://dev5.sc-dev5.io",
      audience: "https://dev5.sc-dev5.io",
      endpoint: "https://api.sc-dev5.io/authentication/token",
      scannerEnv: {
        SONAR_SCANNER_SONARCLOUD_URL: "https://dev5.sc-dev5.io",
        SONAR_SCANNER_API_BASE_URL: "https://api.sc-dev5.io",
      },
    });
  });

  it("keeps the path of custom URLs and accepts http", () => {
    const target = resolveTarget({ webBaseUrl: "http://localhost:9000", apiBaseUrl: " http://localhost:9000/api// " });
    assert.equal(target.webUrl, "http://localhost:9000");
    assert.equal(target.endpoint, "http://localhost:9000/api/authentication/token");
  });

  it("rejects a single custom URL", () => {
    assert.throws(() => resolveTarget({ webBaseUrl: "https://dev5.sc-dev5.io" }), /must be set together/);
    assert.throws(() => resolveTarget({ apiBaseUrl: "https://api.sc-dev5.io" }), /must be set together/);
  });

  it("rejects custom URLs combined with a region", () => {
    assert.throws(
      () => resolveTarget({ region: "us", webBaseUrl: "https://dev5.sc-dev5.io", apiBaseUrl: "https://api.sc-dev5.io" }),
      /sonar-region cannot be combined with sonar-web-base-url and sonar-api-base-url/,
    );
  });

  it("rejects a custom URL with an unsupported scheme", () => {
    assert.throws(
      () => resolveTarget({ webBaseUrl: "ftp://dev5.sc-dev5.io", apiBaseUrl: "https://api.sc-dev5.io" }),
      /Invalid sonar-web-base-url 'ftp:\/\/dev5\.sc-dev5\.io': only http and https URLs are supported\./,
    );
  });

  it("rejects a custom URL that is not a URL", () => {
    assert.throws(
      () => resolveTarget({ webBaseUrl: "https://dev5.sc-dev5.io", apiBaseUrl: "api" }),
      /Invalid sonar-api-base-url 'api'/,
    );
  });
});
