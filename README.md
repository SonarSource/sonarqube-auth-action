# SonarQube Auth Action

Exchange the ephemeral GitHub Actions OIDC token of a job for a short-lived SonarQube Cloud token, scoped to the project bound to the repository.
No token is stored in GitHub secrets: nothing to create, rotate or leak.

This action is the step to run right before the SonarQube scan.

## Usage

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

## Prerequisites

- The repository is bound to a project in SonarQube Cloud, through the GitHub integration.
- An administrator of the SonarQube Cloud organization has enabled trusted scanning for GitHub Actions in the organization settings.
- The job has the `id-token: write` permission.

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

## Development

```bash
npm ci
npm test
npm run test:coverage # also writes coverage/lcov.info, read by the SonarQube analysis
npm run build
```

`dist/` is the code GitHub runs, and is committed. The build workflow fails when it is out of date: run `npm run build` and commit the result.

## License

Copyright SonarSource Sàrl. Licensed under the [GNU Lesser General Public License, Version 3.0](LICENSE).
