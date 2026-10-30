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

import { getProxyUrl } from "@actions/http-client";
import { Agent, ProxyAgent, fetch as undiciFetch } from "undici";

const GRANT_TYPE = "urn:ietf:params:oauth:grant-type:token-exchange";
const SUBJECT_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:id_token";
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 30000;

const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;

class TransientError extends Error {}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createDispatcher(url) {
  const proxyUrl = getProxyUrl(url);
  return proxyUrl ? new ProxyAgent(proxyUrl) : new Agent();
}

function describeFailure(error, timeoutMs) {
  if (error.name === "TimeoutError" || error.name === "AbortError") {
    return new Error(`Request timed out after ${timeoutMs} ms`);
  }
  const cause = error.cause;
  return new Error(cause?.message || cause?.code || error.message);
}

export async function proxyAwareFetch(url, { headers, body }, timeoutMs = REQUEST_TIMEOUT_MS) {
  const dispatcher = createDispatcher(url);
  try {
    const response = await undiciFetch(url, {
      method: "POST",
      headers,
      body: body.toString(),
      dispatcher,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    return { status: response.status, text: async () => text };
  } catch (error) {
    throw describeFailure(error, timeoutMs);
  } finally {
    await dispatcher.destroy();
  }
}

function parseJson(text) {
  try {
    const parsed = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function describeRejection(status, body) {
  const detail = body.error_description || body.error || "no details provided";
  switch (status) {
    case HTTP_UNAUTHORIZED:
      return `SonarQube Cloud rejected the GitHub OIDC token: ${detail}`;
    case HTTP_FORBIDDEN:
      return `Access denied: ${detail}. An administrator of the SonarQube Cloud organization must enable trusted scanning for GitHub Actions in the organization settings.`;
    case HTTP_NOT_FOUND:
      return `This repository is not bound to a SonarQube Cloud project (${detail}). Bind it to a project through the GitHub integration of SonarQube Cloud, then run the job again.`;
    default:
      return `The token exchange was rejected with HTTP ${status}: ${detail}`;
  }
}

async function postExchange(fetchFn, { endpoint, audience, subjectToken, projectKey }) {
  const form = new URLSearchParams({
    grant_type: GRANT_TYPE,
    subject_token: subjectToken,
    subject_token_type: SUBJECT_TOKEN_TYPE,
    audience,
  });
  if (projectKey) {
    form.set("project_key", projectKey);
  }
  const response = await fetchFn(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  return { status: response.status, body: parseJson(await response.text()) };
}

function toResult(status, body) {
  if (status >= HTTP_SERVER_ERROR) {
    throw new TransientError(`HTTP ${status}`);
  }
  if (status !== HTTP_OK) {
    throw new Error(describeRejection(status, body));
  }
  if (!body.access_token) {
    throw new Error("The token exchange succeeded but the response contains no access_token.");
  }
  return {
    accessToken: body.access_token,
    organization: body.organization ?? "",
    projectKey: body.project_key ?? "",
    expiresIn: Number.isFinite(body.expires_in) ? body.expires_in : undefined,
  };
}

async function attemptExchange(fetchFn, request) {
  let response;
  try {
    response = await postExchange(fetchFn, request);
  } catch (error) {
    throw new TransientError(error.message);
  }
  return toResult(response.status, response.body);
}

export async function exchangeToken(request, { fetchFn = proxyAwareFetch, sleepFn = defaultSleep, log = () => {} } = {}) {
  async function attempt(number) {
    try {
      return await attemptExchange(fetchFn, request);
    } catch (error) {
      if (!(error instanceof TransientError)) {
        throw error;
      }
      if (number >= MAX_ATTEMPTS) {
        throw new Error(`SonarQube Cloud is unreachable or unavailable (${error.message}) after ${MAX_ATTEMPTS} attempts.`);
      }
      log(`Token exchange attempt ${number} of ${MAX_ATTEMPTS} failed (${error.message}), retrying.`);
      await sleepFn(RETRY_DELAY_MS * number);
      return attempt(number + 1);
    }
  }
  return attempt(1);
}
