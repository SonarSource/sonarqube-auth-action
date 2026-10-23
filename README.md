<!-- Sonar Marketing hosts these approved brand assets on its Kentico Kontent CDN (assets-eu-01.kc-usercontent.com).
Shared URLs are intentional; consult Marketing before replacing them. -->
<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://assets-eu-01.kc-usercontent.com/ef593040-b591-0198-9506-ed88b30bc023/a23fc7ba-23f0-489a-829d-ed88c0748521/Sonar_Logo_Dark%20Backgrounds.svg">
    <img
      src="https://assets-eu-01.kc-usercontent.com/ef593040-b591-0198-9506-ed88b30bc023/82c13eba-d95c-4bb8-8007-7ce77c14e043/Sonar_Logo_Light%20Backgrounds.svg"
      alt="Sonar logo" width="400">
  </picture>
</p>

[![Build status](https://github.com/SonarSource/sonarqube-auth-action/actions/workflows/build.yml/badge.svg)](https://github.com/SonarSource/sonarqube-auth-action/actions/workflows/build.yml)

<!-- sonar-marketing:start -->
<!-- Marketing maintains this section. For wording changes, consult the relevant Product Marketing Manager (PMM).
Repository CODEOWNERS review accuracy and merge changes. -->

# Authenticate your SonarQube Cloud scan without a stored token

If you analyze code with [SonarQube Cloud](https://www.sonarsource.com/products/sonarqube/cloud/) in GitHub Actions,
this action lets your workflow scan without any stored secret.
It exchanges the ephemeral GitHub Actions OpenID Connect (OIDC) token of the job for a short-lived SonarQube Cloud token,
scoped to the project bound to the repository. Run it right before the
[SonarQube scan action](https://github.com/SonarSource/sonarqube-scan-action).

Continue to the [quick start](#quick-start) to configure authentication for your workflow.

<!-- sonar-marketing:end -->

## Why use this action?

- **No secret to store.** No `SONAR_TOKEN` to create, copy into GitHub secrets, rotate, or leak.
- **Short-lived.** The token lasts 30 minutes. A token exposed in a log or a cache is of no use soon after.
- **Least privilege.** The token can only analyze the project bound to the repository, not the whole organization.
- **Not tied to a person.** No personal token expires, and none needs revoking when its owner leaves.
- **One line.** The action exports `SONAR_TOKEN` and `SONAR_HOST_URL`. The scan action and the SonarScanners need no extra setup.
  The outputs cover every other case.

## Quick start

### 1. Prerequisites

Before you add the action, check that:

- The repository is bound to a project in SonarQube Cloud, through the GitHub integration.
- An administrator of the SonarQube Cloud organization has enabled trusted scanning for GitHub Actions in the organization settings.
- The job has the `id-token: write` permission.
- If the organization restricts access with an IP allow list, the runner must run from an allowed IP address.
  GitHub-hosted runners with shared IP addresses cannot be added to an allow list.

### 2. Workflow example

```yaml
name: Analysis
on:
  push:
    branches: [main]
  pull_request:

jobs:
  sonarqube:
    runs-on: ubuntu-latest
    permissions:
      id-token: write # lets the job request a GitHub OIDC token
      contents: read
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: SonarSource/sonarqube-auth-action@v1
        id: auth
      - uses: SonarSource/sonarqube-scan-action@v8
        with:
          args: >
            -Dsonar.organization=${{ steps.auth.outputs.organization }}
            -Dsonar.projectKey=${{ steps.auth.outputs.project-key }}
```

You do not configure a `SONAR_TOKEN`: the action exports `SONAR_TOKEN` and `SONAR_HOST_URL` for the later steps of the job.

The organization and project key come back with the token, as the `organization` and `project-key` outputs.
The scanner needs both. Pass them with `args`.
If your `sonar-project.properties` already sets `sonar.organization` and `sonar.projectKey`, you can drop the `id` and the `args`.

Other scanners read the same outputs, for example Gradle:

```yaml
- uses: SonarSource/sonarqube-auth-action@v1
  id: auth
- run: ./gradlew sonar
  env:
    SONAR_SCANNER_JSON_PARAMS: >-
      {"sonar.organization": "${{ steps.auth.outputs.organization }}",
      "sonar.projectKey": "${{ steps.auth.outputs.project-key }}"}
```

### SonarQube Cloud US

Set `sonar-host-url` to target the US instance. The default is the EU instance, `https://sonarcloud.io`.

```yaml
- uses: SonarSource/sonarqube-auth-action@v1
  id: auth
  with:
    sonar-host-url: https://sonarqube.us
- uses: SonarSource/sonarqube-scan-action@v8
  with:
    args: >
      -Dsonar.organization=${{ steps.auth.outputs.organization }}
      -Dsonar.projectKey=${{ steps.auth.outputs.project-key }}
```

With `export-env: true`, the action exports `SONAR_HOST_URL=https://sonarqube.us` together with the token.
The scan step needs no other change.
The organization and the project must be the ones of your SonarQube Cloud US account.

If you set `export-env: false`, pass the values to the scan yourself:

```yaml
- uses: SonarSource/sonarqube-auth-action@v1
  id: auth
  with:
    sonar-host-url: https://sonarqube.us
    export-env: false
- uses: SonarSource/sonarqube-scan-action@v8
  env:
    SONAR_TOKEN: ${{ steps.auth.outputs.sonar-token }}
    SONAR_HOST_URL: ${{ steps.auth.outputs.sonar-host-url }}
  with:
    args: >
      -Dsonar.organization=${{ steps.auth.outputs.organization }}
      -Dsonar.projectKey=${{ steps.auth.outputs.project-key }}
```

## Inputs

| Input | Default | Description |
|---|---|---|
| `sonar-host-url` | `https://sonarcloud.io` | SonarQube Cloud instance: `https://sonarcloud.io` or `https://sonarqube.us`. |
| `export-env` | `true` | Export `SONAR_TOKEN` and `SONAR_HOST_URL` to the next steps of the job. |

## Outputs

| Output | Description |
|---|---|
| `sonar-token` | The short-lived, project-scoped token. Masked in the logs. |
| `organization` | Key of the organization that owns the project. |
| `project-key` | Key of the project bound to the repository. |
| `sonar-host-url` | The SonarQube Cloud instance that issued the token. |

## Security

- The token lasts 30 minutes. Run the action right before the scan, not at the start of a long job.
- With `export-env: true`, every later step of the job can read `SONAR_TOKEN`, including third-party actions.
  If that matters to you, set `export-env: false` and pass the `sonar-token` output only to the steps that need it.
- Workflows triggered by pull requests from forks do not get the `id-token: write` permission, which makes the action fail there.
  That's a GitHub restriction, and it's what keeps the exchange out of reach of untrusted code.

## Troubleshooting

| Message | Cause and fix |
|---|---|
| `No GitHub OIDC token is available to this job` | The job lacks the `id-token: write` permission. Add `permissions: id-token: write` to the job. GitHub does not grant it to pull requests from forks. |
| `Access denied` | The organization has not enabled trusted scanning for GitHub Actions. Ask an administrator to enable it in the organization settings. |
| `This repository is not bound to a SonarQube Cloud project` | Bind the repository to a project through the GitHub integration of SonarQube Cloud. |
| `Unsupported sonar-host-url` | The URL is not one of the supported SonarQube Cloud instances. Use `https://sonarcloud.io` or `https://sonarqube.us`. |
| `HTTP 403` from the scanner, right after a successful exchange | The organization IP allow list does not include the IP address of the runner. Add it, or use a runner with a fixed IP address. |

## Development

To build and test the action locally:

```bash
npm ci
npm test
npm run test:coverage # also writes coverage/lcov.info, read by the SonarQube analysis
npm run build
```

`dist/` is the code GitHub runs, and is committed. The build workflow fails when it's out of date: run `npm run build` and commit the result.

## Support and community

To request a feature or report a bug, post in the
[GitHub Actions topic of the SonarSource Community forum](https://community.sonarsource.com/tags/c/sc/9/github-actions/200).

## License

Copyright SonarSource Sàrl. Licensed under the [GNU Lesser General Public License, Version 3.0](LICENSE).
