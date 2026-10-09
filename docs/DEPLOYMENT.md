# Deploying to Azure from a local machine

This project uses Azure Developer CLI (`azd`) and Bicep for infrastructure.
GitHub Actions builds and publishes the web container image to GHCR; all Azure
provisioning and deployment commands are run locally.

## Architecture

- The SvelteKit Node.js web application runs as a Linux custom container in
  Azure App Service.
- The timer and queue worker runs in a separate Linux Azure Functions app.
- Both apps share a Linux Basic B1 App Service plan and an Azure Storage
  account. The web app and worker use separate user-assigned managed identities.
- Blob, Queue, and Table Storage data is accessed with Microsoft Entra ID.
  Storage public blob access and shared-key authentication are disabled.
- Application Insights and a Log Analytics workspace collect application and
  platform diagnostics.

The Basic plan provides a simple, always-on starting point for this small
application. It does not autoscale; revisit the hosting plan if workload or
availability requirements change.

Release-please manages one SemVer version for the web app and Functions worker.
The release workflow publishes a `vMAJOR.MINOR.PATCH` web image to GHCR and a
versioned Functions ZIP to an immutable GitHub release. There is no `latest`
or rolling major/minor image tag. The workflow does not authenticate to Azure
or deploy anything. `azd` uses
image passthrough, so it updates the App Service image reference without
building or uploading the web application from the local checkout. The
Functions worker continues to be packaged and deployed locally.

The worker package includes production dependencies. Its `.funcignore` is
copied into the staging directory so `azd` does not exclude `node_modules`.
Functions uses run-from-package and Node v4 worker indexing, avoiding remote
builds and slow extraction of individual dependency files.

## Prerequisites

Install and sign in to:

- Azure CLI (`az`)
- Azure Developer CLI (`azd`)
- Node.js 22 and npm
- GitHub CLI (`gh`) if you want to start/download a workflow run from the
  terminal

The signed-in Azure identity needs permission to create the listed resources and
to create role assignments in the target subscription/resource group. Resource
creation incurs Azure charges.

## Publish release artifacts

After the workflow is merged to `main`, Conventional Commits drive a
release-please PR that updates package versions and the changelog. Merging that
PR creates a draft release, builds artifacts from its exact tag, attaches the
Functions ZIP, `web-image.txt`, and `SHA256SUMS`, then publishes the release.

```text
ghcr.io/sjovang/alzlib-diff-for-humans:v0.1.0
functions-v0.1.0.zip
web-image.txt
SHA256SUMS
```

`web-image.txt` contains the immutable `ghcr.io/...@sha256:...` reference to
deploy, not the version tag. GHCR tags are technically mutable; the workflow
does not overwrite existing version tags, and deployments use the digest so
they cannot silently change. GitHub's native release immutability locks the
published tag and attached assets. Do not delete published images; roll back
by selecting an earlier digest, or fix a release with a new SemVer version.

The repository must have **immutable releases** enabled and **Allow GitHub
Actions to create and approve pull requests** enabled in its Actions settings.
Both settings were enabled when this workflow was introduced. The workflow
fails rather than publishing an unlocked release if immutability is disabled.
It uses the built-in `GITHUB_TOKEN`; artifact publication runs in the same
workflow because releases created with that token do not trigger another
release-event workflow. No Azure credential is required.

If artifact publication fails, the release stays a draft. Resume it through
**Release artifacts** in the Actions tab with the existing tag. Existing image
tags are reused only after their source revision and version are checked;
already attached assets are retained and checked, never overwritten. Do not
publish the draft manually before all artifacts have been attached. The GHCR
package is private by default.

## First deployment

Create a local `azd` environment, choose the subscription and region, and set
`WEB_IMAGE` to the digest reference from a published release's `web-image.txt`:

```sh
azd env new dev
azd env set AZURE_SUBSCRIPTION_ID <subscription-id>
azd env set AZURE_LOCATION <azure-region>
gh release download v0.1.0 --pattern 'web-image.txt' --pattern 'SHA256SUMS' --pattern 'functions-v0.1.0.zip' --dir .azure-build/releases/v0.1.0
(cd .azure-build/releases/v0.1.0 && shasum -a 256 -c SHA256SUMS)
azd env set WEB_IMAGE "$(cat .azure-build/releases/v0.1.0/web-image.txt)"
```

The `.azure/` directory contains local environment state and is ignored by Git.
Do not commit environment-specific state or credentials.

Provision infrastructure first:

```sh
azd provision --preview
azd provision
```

Because the GHCR package is private, configure App Service's registry
credentials before deploying the web image. Bicep sets
`DOCKER_REGISTRY_SERVER_URL` to `https://ghcr.io`. In the Azure portal, open
the web App Service's **Configuration** page and add:

- `DOCKER_REGISTRY_SERVER_USERNAME`: your GitHub username
- `DOCKER_REGISTRY_SERVER_PASSWORD`: a GitHub classic personal access token
  with `read:packages` permission and access to this package

Add the username and token through the portal's secure configuration UI; do
not put the token in source control, the `azd` environment, or command-line
arguments. Restart the web app after saving the settings.

Bicep preserves these portal-managed registry credentials on subsequent
provisioning runs while updating the application's non-secret settings.

Then deploy both services:

```sh
azd deploy web
azd deploy worker --from-package .azure-build/releases/v0.1.0/functions-v0.1.0.zip
```

The web app URL is printed by `azd` and is also available in the Azure portal.
The first scheduled release sync runs hourly. An optional `GITHUB_TOKEN`
application setting on the Function App increases the upstream GitHub API rate
limit; configure it in Azure if needed and keep it out of source control.
Bicep preserves optional portal-managed Function App settings, including this
token, on subsequent provisioning runs.

After first-time setup, `azd up` can provision and deploy both services in one
step, provided `WEB_IMAGE` points to an image that exists and the GHCR pull
credentials are configured. Its worker deployment builds the local checkout;
use the versioned ZIP commands above when deploying published releases.

## Deploy code changes

Download the selected release, verify its checksums, and deploy both artifacts
from your local terminal (replace `v0.1.0` with the desired release):

```sh
gh release download v0.1.0 --pattern 'web-image.txt' --pattern 'SHA256SUMS' --pattern 'functions-v0.1.0.zip' --dir .azure-build/releases/v0.1.0
(cd .azure-build/releases/v0.1.0 && shasum -a 256 -c SHA256SUMS)
azd env set WEB_IMAGE "$(cat .azure-build/releases/v0.1.0/web-image.txt)"
azd deploy web
azd deploy worker --from-package .azure-build/releases/v0.1.0/functions-v0.1.0.zip
```

For unreleased development changes, deploy Functions from the local checkout:

```sh
azd deploy worker
```

Neither deployment requires infrastructure provisioning. `azd up` is also
available when both infrastructure and both service deployments should be
updated.

## Infrastructure changes

Review infrastructure changes before applying them:

```sh
azd provision --preview
azd provision
```

Alternatively, `azd up` provisions and deploys in one operation. Remove the
environment's Azure resources when they are no longer needed:

```sh
azd down
```

This deletes resources in the environment's resource group; review the target
environment before confirming.
