# Authenticate your SonarQube scan without a token [![Build status](https://github.com/SonarSource/sonarqube-auth-action/actions/workflows/build.yml/badge.svg)](https://github.com/SonarSource/sonarqube-auth-action/actions/workflows/build.yml)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./images/SQ_Logo_Server_Cloud_Dark_Backgrounds.png">
  <img
    alt="SonarQube Server and SonarQube Cloud logo: a blue radiating-waves icon beside the SonarQube wordmark, with server | cloud below it"
    src="./images/SQ_Logo_Server_Cloud_Light_Backgrounds.png">
</picture>

## A GitHub Action for SonarQube Cloud

If you analyze code with [SonarQube Cloud](https://www.sonarsource.com/products/sonarqube/cloud/) in GitHub Actions,
this action lets your workflow scan without any stored secret.
It exchanges the ephemeral GitHub Actions OIDC token of the job for a short-lived SonarQube Cloud token,
scoped to the project bound to the repository. Run it right before the
[SonarQube scan action](https://github.com/SonarSource/sonarqube-scan-action).

### Why use it?

- **No secret to store.** No `SONAR_TOKEN` to create, copy into GitHub secrets, rotate, or leak.
- **Short-lived.** The token lasts 30 minutes. A token exposed in a log or a cache is of no use soon after.
- **Least privilege.** The token can only analyze the project bound to the repository, not the whole organization.
- **Not tied to a person.** No personal token expires, and none needs revoking when its owner leaves.
- **One line.** The action exports `SONAR_TOKEN`. The scan action and the SonarScanners need no extra setup.
  The outputs cover every other case.

### What is SonarQube Cloud?

[SonarQube Cloud](https://www.sonarsource.com/products/sonarqube/cloud/) is a static analysis solution
that continuously checks code quality and security and helps you fix the issues it finds.
The platform supports 30+ languages, frameworks, and IaC platforms, including Java, JavaScript,
TypeScript, C#, Python, C, C++, and [many more languages](https://www.sonarsource.com/knowledge/languages/).

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

You do not configure a `SONAR_TOKEN`: the action exports it for the later steps of the job.

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

Set `sonar-region` to `us` to target the US instance, `https://sonarqube.us`. The default is the EU instance, `https://sonarcloud.io`.

```yaml
- uses: SonarSource/sonarqube-auth-action@v1
  id: auth
  with:
    sonar-region: us
- uses: SonarSource/sonarqube-scan-action@v8
  with:
    args: >
      -Dsonar.organization=${{ steps.auth.outputs.organization }}
      -Dsonar.projectKey=${{ steps.auth.outputs.project-key }}
```

With `export-env: true`, the action exports `SONAR_REGION=us` together with the token.
The scan step needs no other change.
The organization and the project must be the ones of your SonarQube Cloud US account.

If you set `export-env: false`, pass the values to the scan yourself:

```yaml
- uses: SonarSource/sonarqube-auth-action@v1
  id: auth
  with:
    sonar-region: us
    export-env: false
- uses: SonarSource/sonarqube-scan-action@v8
  env:
    SONAR_TOKEN: ${{ steps.auth.outputs.sonar-token }}
    SONAR_REGION: ${{ steps.auth.outputs.sonar-region }}
  with:
    args: >
      -Dsonar.organization=${{ steps.auth.outputs.organization }}
      -Dsonar.projectKey=${{ steps.auth.outputs.project-key }}
```

## Inputs

| Input | Default | Description |
|---|---|---|
| `sonar-region` | `eu` | SonarQube Cloud region: `eu` (`https://sonarcloud.io`) or `us` (`https://sonarqube.us`). |
| `sonar-api-base-url` | | Advanced, for testing on non-production environments only: API base URL of the environment to exchange the token with. Requires `oidc-audience`. Cannot be combined with `sonar-region`. Configure the scanner for the same environment separately. |
| `oidc-audience` | | Advanced, for testing on non-production environments only: audience of the GitHub OIDC token expected by that environment. Requires `sonar-api-base-url`. |
| `export-env` | `true` | Export `SONAR_TOKEN` to the next steps of the job, with `SONAR_REGION` for the `us` region. |

## Outputs

| Output | Description |
|---|---|
| `sonar-token` | The short-lived, project-scoped token. Masked in the logs. |
| `organization` | Key of the organization that owns the project. |
| `project-key` | Key of the project bound to the repository. |
| `sonar-region` | Region to pass to the scanner as `SONAR_REGION`: `us` for the `us` region, empty for the `eu` region, which is the scanner default. |

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
| `Unsupported sonar-region` | The region is not one of the supported SonarQube Cloud regions. Use `eu` or `us`. |
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
