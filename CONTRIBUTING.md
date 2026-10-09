# Contributing

## Local development

Requirements: Node.js 22+, Git, and [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local).

Run everything in **one terminal**:

```sh
npm install
npm run dev:all
```

Open **http://127.0.0.1:5173** when the command says the services are ready.
Press **Ctrl+C** to stop all the processes it started.

`dev:all` creates `.env` and `local.settings.json` from their examples if they
are missing, without overwriting existing files. It checks prerequisites,
builds the Functions worker, starts Azurite, waits for storage, synchronizes
both release streams and their pinned dependencies, then starts the Functions
worker and web app. The first release sync can take a while; later runs reuse
stored snapshots. All process output appears in the same terminal.

This command uses local Azurite storage (`UseDevelopmentStorage=true`).
If your existing configuration points elsewhere, use the individual commands
below instead. Queue names and sync schedules must match between `.env` and
`local.settings.json`. If ports 10000-10002, 7071, or 5173 are occupied, stop
your existing dev services first; `dev:all` does not kill or reuse unrelated
processes. A startup or service failure stops the other processes it started
and exits with an error.

### Running services separately

For custom setups, `npm run storage:start`, `npm run releases:sync`,
`npm run functions:start`, and `npm run dev` remain available.

### Running in the GitHub Copilot app

Review and accept `.github/github-app.yml` when the app prompts you. It
installs dependencies with `npm ci` when a new session is created and adds a
manual **Run locally** action that runs `npm run dev:all`. For an existing
session without dependencies, run **Setup** first.

Once all services are ready, the app opens the local instance in its integrated
browser. Node.js, Git, and Azure Functions Core Tools v4 must already be
installed on the execution host. Only run one local instance at a time because
the services use fixed ports. Stop the run script in the app to shut down its
services. Repository configuration changes must be reviewed and accepted again
before the app uses them.

Azurite listens on its standard Blob, Queue, and Table ports. The local emulator skips API-version validation because current Azure Storage SDKs can send a version newer than Azurite supports; this option affects only the local emulator, not Azure Storage. The `.env` and Functions local settings file are ignored by Git. Page loads read the synchronized ALZ/SLZ catalog; choosing a same-library pair queues report generation. Completed reports are reused by repository, library scope, selected tags, commit SHAs, pinned dependency SHAs, and report schema version. Keep the Functions worker running alongside the web app: without it, only already-cached comparisons complete. Queue messages are plain JSON, so `host.json` explicitly sets queue `messageEncoding` to `none` to match the storage SDK producer.

`npm run dev`, `npm run preview`, and `npm start` load server configuration from
the optional local `.env` file; environment variables supplied by the host take
precedence. To preview a production build locally, keep Azurite running and use
`npm run build && npm run preview`. Preview does not start storage or the
Functions worker. A “Storage is not configured” error means the server has
neither local `.env` configuration nor host-provided storage settings; copy
`.env.example` to `.env` and restart it.

## Release synchronization and caching

`RELEASE_SYNC_SCHEDULE` is a six-field NCRONTAB expression in UTC, defaulting to `0 0 * * * *` (hourly). The Functions host must be running for the timer to execute; starting only the web app does not schedule syncs. `npm run releases:sync` runs the same sync manually without Core Tools. `GITHUB_TOKEN`, if configured, is used only during discovery.

See [Release catalog and comparison data](docs/TECHNICAL_OVERVIEW.md#release-catalog-and-comparison-data) for how synchronization, snapshots, and cached reports work.

## Validation

- `npm run check` runs the Svelte and TypeScript checks.
- `npm run build` builds the App Service app.
- `npm run build:functions` compiles the Functions worker.
- `npm run test:unit` runs the semantic policy analysis and GitHub API tests.
- `npx playwright install chromium` installs the browser once; `npm run test:e2e` runs the browser flow.
