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
import { DEFAULT_HOST_URL, resolveTarget } from "../main/hosts.js";

describe("resolveTarget", () => {
  it("resolves the default host to the EU endpoint and audience", () => {
    assert.deepEqual(resolveTarget(DEFAULT_HOST_URL), {
      hostUrl: "https://sonarcloud.io",
      audience: "https://sonarcloud.io",
      endpoint: "https://api.sonarcloud.io/authentication/token",
    });
  });

  it("resolves the US host", () => {
    assert.deepEqual(resolveTarget("https://sonarqube.us"), {
      hostUrl: "https://sonarqube.us",
      audience: "https://sonarqube.us",
      endpoint: "https://api.sonarqube.us/authentication/token",
    });
  });

  it("resolves the AU host", () => {
    assert.equal(resolveTarget("https://sonarqube.au").endpoint, "https://api.sonarqube.au/authentication/token");
  });

  it("ignores trailing slash, path, case and surrounding whitespace", () => {
    assert.equal(resolveTarget("  HTTPS://SonarCloud.IO/some/path/  ").hostUrl, "https://sonarcloud.io");
  });

  it("rejects an unsupported host and lists the supported ones", () => {
    assert.throws(
      () => resolveTarget("https://sonar.example.com"),
      /Unsupported sonar-host-url 'https:\/\/sonar\.example\.com'.*https:\/\/sonarcloud\.io, https:\/\/sonarqube\.us, https:\/\/sonarqube\.au/,
    );
  });

  it("rejects a host that only ends with a supported one", () => {
    assert.throws(() => resolveTarget("https://evil-sonarcloud.io"), /Unsupported sonar-host-url/);
    assert.throws(() => resolveTarget("https://sonarcloud.io.evil.com"), /Unsupported sonar-host-url/);
  });

  it("rejects a non-https URL", () => {
    assert.throws(() => resolveTarget("http://sonarcloud.io"), /Unsupported sonar-host-url/);
  });

  it("rejects something that is not a URL", () => {
    assert.throws(() => resolveTarget("sonarcloud"), /Invalid sonar-host-url 'sonarcloud'/);
  });
});
