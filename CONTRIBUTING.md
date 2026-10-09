# Contributing

## Local development

Requirements: Node.js 22+, Git, and (to run the queue worker) Azure Functions Core Tools v4.

1. Install packages with `npm install`.
2. Copy `.env.example` to `.env`.
3. Start the local storage emulator with `npm run storage:start`.
4. In another terminal, run `npm run releases:sync` to populate the catalog and cache the newest two releases.
5. Start the SvelteKit app with `npm run dev`.
6. To process comparison jobs and scheduled release syncs locally, copy `local.settings.example.json` to `local.settings.json`, then run `npm run functions:start`.

Azurite listens on its standard Blob, Queue, and Table ports. The local emulator skips API-version validation because current Azure Storage SDKs can send a version newer than Azurite supports; this option affects only the local emulator, not Azure Storage. The `.env` and Functions local settings file are ignored by Git. Page loads read the synchronized ALZ catalog; choosing a pair queues report generation. Completed reports are reused by repository, ALZ path, commit SHAs, and report schema version. Keep the Functions worker running alongside the web app: without it, only already-cached comparisons complete. Queue messages are plain JSON, so `host.json` explicitly sets queue `messageEncoding` to `none` to match the storage SDK producer.

`npm run dev`, `npm run preview`, and `npm start` load server configuration from
the optional local `.env` file; environment variables supplied by the host take
precedence. To preview a production build locally, keep Azurite running and use
`npm run build && npm run preview`. Preview does not start storage or the
Functions worker. A “Storage is not configured” error means the server has
neither local `.env` configuration nor host-provided storage settings; copy
`.env.example` to `.env` and restart it.

## Release synchronization and caching

`RELEASE_SYNC_SCHEDULE` is a six-field NCRONTAB expression in UTC, defaulting to `0 0 * * * *` (hourly). The Functions host must be running for the timer to execute; starting only the web app does not schedule syncs. `npm run releases:sync` runs the same sync manually without Core Tools. `GITHUB_TOKEN`, if configured, is used only during discovery.

Each sync lists all matching ALZ tags with one request. Lightweight tag commits come directly from that listing; unchanged annotated tags reuse their stored resolution. Catalog updates are atomic and guarded by the previous Blob ETag, so a concurrent sync cannot overwrite a newer catalog. GitHub errors, incomplete discovery, or snapshot warm-up failures retain the last successful catalog. `/api/releases` includes `syncedAt`; its contents represent that sync, not a live assertion that tags are still published. An empty store returns an actionable 503 rather than falling back to GitHub on each request.

ALZ contents are stored in `releases/snapshots-v1/<commit-sha>.json` and reused across comparison pairs and process restarts. The newest two releases are warmed during sync; older releases are fetched by immutable commit via Git and stored when first compared. Concurrent requests in one process share that fetch; independent worker instances may fetch the same missing snapshot concurrently, but conditional Blob creation prevents replacement. No GitHub REST calls are made for comparison generation. Moved or removed tags are reflected after the next successful sync; a queued comparison fails explicitly if its selected tags no longer match the catalog. Existing completed reports remain available by job ID.

## Validation

- `npm run check` runs the Svelte and TypeScript checks.
- `npm run build` builds the App Service app.
- `npm run build:functions` compiles the Functions worker.
- `npm run test:unit` runs the semantic policy analysis and GitHub API tests.
- `npx playwright install chromium` installs the browser once; `npm run test:e2e` runs the browser flow.
