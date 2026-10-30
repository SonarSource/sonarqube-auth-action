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

import { exchangeToken } from "./exchange.js";
import { resolveTarget } from "./hosts.js";

const SECONDS_PER_MINUTE = 60;
const SUMMARY_HEADING_LEVEL = 3;

async function requestOidcToken(core, audience) {
  if (!process.env.ACTIONS_ID_TOKEN_REQUEST_URL) {
    throw new Error(
      "No GitHub OIDC token is available to this job. Add 'permissions: id-token: write' to the job or the workflow. " +
        "GitHub never grants this permission to workflows triggered by pull requests from forks, so trusted scanning cannot run for them.",
    );
  }
  return core.getIDToken(audience);
}

function publishResult(core, target, result, exportEnv) {
  core.setSecret(result.accessToken);
  core.setOutput("sonar-token", result.accessToken);
  core.setOutput("organization", result.organization);
  core.setOutput("project-key", result.projectKey);
  core.setOutput("sonar-region", target.scannerEnv.SONAR_REGION ?? "");
  if (exportEnv) {
    core.exportVariable("SONAR_TOKEN", result.accessToken);
    for (const [name, value] of Object.entries(target.scannerEnv)) {
      core.exportVariable(name, value);
    }
  }
}

async function writeSummary(core, target, result) {
  const header = (data) => ({ data, header: true });
  try {
    await core.summary
      .addHeading("SonarQube trusted scan", SUMMARY_HEADING_LEVEL)
      .addTable([
        [header("API"), header("Organization"), header("Project")],
        [target.apiUrl, result.organization, result.projectKey],
      ])
      .write();
  } catch (error) {
    core.debug(`Job summary not written: ${error.message}`);
  }
}

function describeExpiry(result) {
  if (result.expiresIn === undefined) {
    return "";
  }
  return `, valid for ${Math.round(result.expiresIn / SECONDS_PER_MINUTE)} minutes`;
}

export async function run(core, { fetchFn, sleepFn } = {}) {
  try {
    const target = resolveTarget({
      region: core.getInput("sonar-region"),
      apiBaseUrl: core.getInput("sonar-api-base-url"),
      audience: core.getInput("oidc-audience"),
    });
    const exportEnv = core.getBooleanInput("export-env");
    const projectKey = core.getInput("project-key").trim();

    const subjectToken = await requestOidcToken(core, target.audience);
    const result = await exchangeToken(
      { endpoint: target.endpoint, audience: target.audience, subjectToken, projectKey },
      { fetchFn, sleepFn, log: core.info },
    );

    publishResult(core, target, result, exportEnv);
    core.info(
      `Obtained a SonarQube token for organization '${result.organization}' and project '${result.projectKey}'${describeExpiry(result)}.`,
    );
    await writeSummary(core, target, result);
  } catch (error) {
    core.setFailed(error.message);
  }
}
