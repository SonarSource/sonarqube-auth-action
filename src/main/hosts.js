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

export const DEFAULT_HOST_URL = "https://sonarcloud.io";

export const SUPPORTED_HOSTNAMES = ["sonarcloud.io", "sonarqube.us"];

export function resolveTarget(rawHostUrl) {
  let url;
  try {
    url = new URL(rawHostUrl.trim());
  } catch {
    throw new Error(`Invalid sonar-host-url '${rawHostUrl}': expected a URL such as ${DEFAULT_HOST_URL}.`);
  }

  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || !SUPPORTED_HOSTNAMES.includes(hostname)) {
    const supported = SUPPORTED_HOSTNAMES.map((host) => "https://" + host).join(", ");
    throw new Error(
      `Unsupported sonar-host-url '${rawHostUrl}'. Trusted scanning with GitHub Actions is available on: ${supported}.`,
    );
  }

  return {
    hostUrl: `https://${hostname}`,
    audience: `https://${hostname}`,
    endpoint: `https://api.${hostname}/authentication/token`,
  };
}
