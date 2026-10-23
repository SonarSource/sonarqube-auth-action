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
  eu: { webUrl: "https://sonarcloud.io", apiUrl: "https://api.sonarcloud.io", scannerEnv: {} },
  us: { webUrl: "https://sonarqube.us", apiUrl: "https://api.sonarqube.us", scannerEnv: { SONAR_REGION: "us" } },
};

export const SUPPORTED_REGIONS = Object.keys(REGIONS);

const TOKEN_PATH = "/authentication/token";

function toTarget(webUrl, apiUrl, scannerEnv) {
  return { webUrl, audience: webUrl, endpoint: apiUrl + TOKEN_PATH, scannerEnv };
}

function resolveRegion(rawRegion) {
  const region = rawRegion.trim().toLowerCase() || DEFAULT_REGION;
  if (!Object.hasOwn(REGIONS, region)) {
    throw new Error(`Unsupported sonar-region '${rawRegion}'. Supported regions: ${SUPPORTED_REGIONS.join(", ")}.`);
  }
  const { webUrl, apiUrl, scannerEnv } = REGIONS[region];
  return toTarget(webUrl, apiUrl, scannerEnv);
}

function parseBaseUrl(inputName, rawUrl) {
  let url;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error(`Invalid ${inputName} '${rawUrl}': expected an http or https URL.`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Invalid ${inputName} '${rawUrl}': only http and https URLs are supported.`);
  }
  return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
}

function resolveCustomUrls(rawWebBaseUrl, rawApiBaseUrl) {
  if (!rawWebBaseUrl || !rawApiBaseUrl) {
    throw new Error("sonar-web-base-url and sonar-api-base-url must be set together.");
  }
  const webUrl = parseBaseUrl("sonar-web-base-url", rawWebBaseUrl);
  const apiUrl = parseBaseUrl("sonar-api-base-url", rawApiBaseUrl);
  return toTarget(webUrl, apiUrl, { SONAR_SCANNER_SONARCLOUD_URL: webUrl, SONAR_SCANNER_API_BASE_URL: apiUrl });
}

export function resolveTarget({ region = "", webBaseUrl = "", apiBaseUrl = "" } = {}) {
  const hasCustomUrls = Boolean(webBaseUrl.trim() || apiBaseUrl.trim());
  if (!hasCustomUrls) {
    return resolveRegion(region);
  }
  if (region.trim()) {
    throw new Error("sonar-region cannot be combined with sonar-web-base-url and sonar-api-base-url.");
  }
  return resolveCustomUrls(webBaseUrl.trim(), apiBaseUrl.trim());
}
