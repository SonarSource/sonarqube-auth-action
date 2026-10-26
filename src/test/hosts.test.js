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

const API_BASE_URL = "https://api.test.example";
const AUDIENCE = "https://audience.test.example";

describe("resolveTarget", () => {
  it("resolves no input to the EU instance without scanner environment", () => {
    assert.deepEqual(resolveTarget(), {
      apiUrl: "https://api.sonarcloud.io",
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
      apiUrl: "https://api.sonarqube.us",
      audience: "https://sonarqube.us",
      endpoint: "https://api.sonarqube.us/authentication/token",
      scannerEnv: { SONAR_REGION: "us" },
    });
  });

  it("ignores the case and surrounding whitespace of the region", () => {
    assert.equal(resolveTarget({ region: "  US " }).apiUrl, "https://api.sonarqube.us");
  });

  it("rejects an unsupported region and lists the supported ones", () => {
    assert.throws(() => resolveTarget({ region: "mars" }), /Unsupported sonar-region 'mars'\. Supported regions: eu, us\./);
  });

  it("rejects a region name inherited from the object prototype", () => {
    assert.throws(() => resolveTarget({ region: "constructor" }), /Unsupported sonar-region/);
  });

  it("uses the custom audience as is, as it does not derive from the API URL, and exports nothing to the scanner", () => {
    assert.deepEqual(resolveTarget({ apiBaseUrl: `${API_BASE_URL}/`, audience: ` ${AUDIENCE} ` }), {
      apiUrl: API_BASE_URL,
      audience: AUDIENCE,
      endpoint: `${API_BASE_URL}/authentication/token`,
      scannerEnv: {},
    });
  });

  it("keeps the path of the custom API URL and accepts http", () => {
    const target = resolveTarget({ apiBaseUrl: " http://localhost:9000/api// ", audience: AUDIENCE });
    assert.equal(target.endpoint, "http://localhost:9000/api/authentication/token");
  });

  it("rejects a custom API URL without an audience", () => {
    assert.throws(() => resolveTarget({ apiBaseUrl: API_BASE_URL }), /sonar-api-base-url requires oidc-audience\./);
  });

  it("rejects an audience without a custom API URL", () => {
    assert.throws(() => resolveTarget({ audience: AUDIENCE }), /oidc-audience requires sonar-api-base-url\./);
  });

  it("rejects a custom API URL combined with a region", () => {
    assert.throws(
      () => resolveTarget({ region: "us", apiBaseUrl: API_BASE_URL, audience: AUDIENCE }),
      /sonar-region cannot be combined with sonar-api-base-url\./,
    );
  });

  it("rejects a custom API URL with an unsupported scheme", () => {
    assert.throws(
      () => resolveTarget({ apiBaseUrl: "ftp://api.test.example", audience: AUDIENCE }),
      /Invalid sonar-api-base-url 'ftp:\/\/api\.test\.example': only http and https URLs are supported\./,
    );
  });

  it("rejects a custom API URL that is not a URL", () => {
    assert.throws(() => resolveTarget({ apiBaseUrl: "api", audience: AUDIENCE }), /Invalid sonar-api-base-url 'api'/);
  });
});
