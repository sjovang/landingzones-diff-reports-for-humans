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

The web image is built in GitHub Actions and published to the repository's
private GHCR package with both an immutable commit-SHA tag and a `latest` tag.
The workflow does not authenticate to Azure or deploy anything. `azd` uses
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

## Publish the web image

After the workflow is merged to the repository's default branch, run **Build
web container image** from the Actions tab, or push to `main`. The workflow
publishes:

```text
ghcr.io/sjovang/alzlib-diff-for-humans:<commit-sha>
```

Use the SHA tag for deployment rather than `latest`, so the deployed version is
reproducible. The package is private by default.

## First deployment

Create a local `azd` environment, choose the subscription and region, and set
`WEB_IMAGE` to a SHA-tagged image that the workflow has already published:

```sh
azd env new dev
azd env set AZURE_SUBSCRIPTION_ID <subscription-id>
azd env set AZURE_LOCATION <azure-region>
azd env set WEB_IMAGE ghcr.io/sjovang/alzlib-diff-for-humans:<commit-sha>
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
azd deploy worker
```

The web app URL is printed by `azd` and is also available in the Azure portal.
The first scheduled release sync runs hourly. An optional `GITHUB_TOKEN`
application setting on the Function App increases the upstream GitHub API rate
limit; configure it in Azure if needed and keep it out of source control.

After first-time setup, `azd up` can provision and deploy both services in one
step, provided `WEB_IMAGE` points to an image that exists and the GHCR pull
credentials are configured.

## Deploy code changes

Run the image workflow for the commit you want to deploy, then set the new
SHA-tagged reference in the local `azd` environment and deploy it:

```sh
azd env set WEB_IMAGE ghcr.io/sjovang/alzlib-diff-for-humans:<commit-sha>
azd deploy web
```

Deploy Functions changes from the local checkout:

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
