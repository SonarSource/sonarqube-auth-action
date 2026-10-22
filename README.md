# Authenticate your SonarQube scan without a token [![Build](https://github.com/SonarSource/sonarqube-auth-action/actions/workflows/build.yml/badge.svg)](https://github.com/SonarSource/sonarqube-auth-action/actions/workflows/build.yml)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./images/SQ_Logo_Server_Cloud_Dark_Backgrounds.png">
  <img alt="SonarQube Logo" src="./images/SQ_Logo_Server_Cloud_Light_Backgrounds.png">
</picture>

## A GitHub Action for SonarQube Cloud

This GitHub Action lets your workflow scan with [SonarQube Cloud](https://www.sonarsource.com/products/sonarcloud/) without any stored secret.
It exchanges the ephemeral GitHub Actions OIDC token of the job for a short-lived SonarQube Cloud token,
scoped to the project bound to the repository. Run it right before the
[SonarQube scan action](https://github.com/SonarSource/sonarqube-scan-action).

### Why use it?

- **No secret to store.** There is no `SONAR_TOKEN` to create, copy into GitHub secrets, rotate or leak.
- **Short-lived.** The token lasts 30 minutes. A token exposed in a log or a cache is of no use soon after.
- **Least privilege.** The token can only analyze the project bound to the repository, not the whole organization.
- **Not tied to a person.** There is no personal token to expire, or to revoke when its owner leaves.
- **One line.** The action exports `SONAR_TOKEN` and `SONAR_HOST_URL`, so the scan action and the SonarScanners need no extra setup.
  The outputs cover every other case.
- **Traceable.** Each token is issued for one OIDC token of one repository, which makes it possible to trace it back.
- **Clear errors.** When something is missing (the `id-token: write` permission, trusted scanning not enabled, a repository not bound
  to a project), the failure says what to fix.
- **Official.** Maintained by SonarSource, for SonarQube Cloud EU and US.

### What is SonarQube Cloud?

[SonarQube Cloud](https://www.sonarsource.com/products/sonarcloud/) is a widely used static analysis solution for continuous code quality,
security inspection, and fix remediation. The platform supports 30+ languages, frameworks, and IaC platforms, including Java, JavaScript,
TypeScript, C#, Python, C, C++, and [many more](https://www.sonarsource.com/knowledge/languages/).

## Quick Start

### 1. Prerequisites

- The repository is bound to a project in SonarQube Cloud, through the GitHub integration.
- An administrator of the SonarQube Cloud organization has enabled trusted scanning for GitHub Actions in the organization settings.
- The job has the `id-token: write` permission.
- If the organization restricts access with an IP allowlist, the runner must run from an allowed IP address.
  GitHub-hosted runners with shared IP addresses cannot be allowlisted.

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

There is no `SONAR_TOKEN` to configure: the action exports `SONAR_TOKEN` and `SONAR_HOST_URL` for the following steps,
which is what the scan action and the SonarScanners read.

The organization and project key come back with the token, as the `organization` and `project-key` outputs.
The scanner needs both, so pass them as above. If your `sonar-project.properties` already sets `sonar.organization` and `sonar.projectKey`,
you can drop the `id` and the `args`.

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

With `export-env: true`, the action exports `SONAR_HOST_URL=https://sonarqube.us` together with the token, so the scan step needs no other change.
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

- The token lasts 30 minutes and can only analyze the project bound to the repository.
  Run the action right before the scan, not at the start of a long job.
- With `export-env: true`, every following step of the job can read `SONAR_TOKEN`, including third-party actions.
  Set `export-env: false` and pass the `sonar-token` output only to the steps that need it if that matters to you.
- Workflows triggered by pull requests from forks do not get the `id-token: write` permission, so the action fails there.
  That is a GitHub restriction, and it is what keeps the exchange out of reach of untrusted code.

## Troubleshooting

| Message | Cause |
|---|---|
| `No GitHub OIDC token is available to this job` | Add `permissions: id-token: write` to the job. Not available for pull requests from forks. |
| `Access denied` | The organization has not enabled trusted scanning for GitHub Actions. |
| `This repository is not bound to a SonarQube Cloud project` | Bind the repository to a project through the GitHub integration of SonarQube Cloud. |
| `Unsupported sonar-host-url` | The URL is not one of the supported SonarQube Cloud instances. |
| `HTTP 403` from the scanner, right after a successful exchange | The organization IP allowlist does not include the IP address of the runner. |

## Development

```bash
npm ci
npm test
npm run test:coverage # also writes coverage/lcov.info, read by the SonarQube analysis
npm run build
```

`dist/` is the code GitHub runs, and is committed. The build workflow fails when it is out of date: run `npm run build` and commit the result.

## Support & Community

To provide feedback (requesting a feature or reporting a bug) please post on the SonarSource Community Forum page for
[SonarQube Cloud](https://community.sonarsource.com/tags/c/help/sc/9/github-actions).

## License

Copyright SonarSource Sàrl. Licensed under the [GNU Lesser General Public License, Version 3.0](LICENSE).
