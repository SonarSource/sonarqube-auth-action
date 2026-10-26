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

export const DEFAULT_REGION = "eu";

const REGIONS = {
  eu: { apiUrl: "https://api.sonarcloud.io", audience: "https://sonarcloud.io", scannerEnv: {} },
  us: { apiUrl: "https://api.sonarqube.us", audience: "https://sonarqube.us", scannerEnv: { SONAR_REGION: "us" } },
};

export const SUPPORTED_REGIONS = Object.keys(REGIONS);

const TOKEN_PATH = "/authentication/token";

function toTarget(apiUrl, audience, scannerEnv) {
  return { apiUrl, audience, endpoint: apiUrl + TOKEN_PATH, scannerEnv };
}

function resolveRegion(rawRegion) {
  const region = rawRegion.trim().toLowerCase() || DEFAULT_REGION;
  if (!Object.hasOwn(REGIONS, region)) {
    throw new Error(`Unsupported sonar-region '${rawRegion}'. Supported regions: ${SUPPORTED_REGIONS.join(", ")}.`);
  }
  const { apiUrl, audience, scannerEnv } = REGIONS[region];
  return toTarget(apiUrl, audience, scannerEnv);
}

function parseBaseUrl(inputName, rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid ${inputName} '${rawUrl}': expected an http or https URL.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Invalid ${inputName} '${rawUrl}': only http and https URLs are supported.`);
  }
  let baseUrl = `${url.origin}${url.pathname}`;
  while (baseUrl.endsWith("/")) {
    baseUrl = baseUrl.slice(0, -1);
  }
  return baseUrl;
}

export function resolveTarget({ region = "", apiBaseUrl = "", audience = "" } = {}) {
  const customApiUrl = apiBaseUrl.trim();
  const customAudience = audience.trim();
  if (!customApiUrl) {
    if (customAudience) {
      throw new Error("oidc-audience requires sonar-api-base-url.");
    }
    return resolveRegion(region);
  }
  if (region.trim()) {
    throw new Error("sonar-region cannot be combined with sonar-api-base-url.");
  }
  if (!customAudience) {
    throw new Error("sonar-api-base-url requires oidc-audience.");
  }
  return toTarget(parseBaseUrl("sonar-api-base-url", customApiUrl), customAudience, {});
}
