# ALZ Release Brief

A read-only comparison tool for published Azure Landing Zones Library releases. The first prototype compares only files under `platform/alz/`; SLZ, AMBA, and other library areas are out of scope.

## Architecture

- **Web app:** SvelteKit + TypeScript with the Node adapter, suitable for Azure App Service.
- **Release source:** An hourly Azure Functions timer discovers ALZ tags through GitHub's API and stores their resolved commit SHAs. Web requests and report jobs read that durable catalog, never the GitHub API. The upstream repository is fixed in server code.
- **Background work:** Azure Functions Node.js v4 queue trigger consumes `report-jobs` messages and analyzes full stored `platform/alz/` inventories, so semantic analysis is not subject to GitHub Compare's 300-file ceiling.
- **Durable state:** Azure Queue Storage for work, Table Storage for job/cache metadata, private Blob containers for report JSON and the release catalog/content snapshots.
- **Local services:** Azurite for Queue, Blob, and Table Storage.

The Azure-hosted app and worker use managed identity through `DefaultAzureCredential` and identity-based Functions storage settings. Grant only the required data-plane roles. Local development uses Azurite and does not need cloud credentials. A server-side `GITHUB_TOKEN` is optional for a higher GitHub API rate limit; never expose it to the browser.

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

The prototype deliberately includes no Bicep and does not deploy Azure resources. Before deployment, decide report retention, configure managed identities and least-privilege roles, ensure Git is available to the Functions worker, and review the storage account/network configuration.

## Human-readable reports

See [Change evaluation and display rules](BUSINESS_RULES.md) for the current
business-rule catalog, summary precedence, deprecation decisions, assignment
resolution, display rules, worked examples, and known tuning boundaries.

Reports lead with policy and initiative names, purpose, version changes, parameter/default changes, and explanations of supported policy conditions. Assignment effects are resolved from policy defaults, initiative member bindings, and assignment parameter values. Library scope is resolved from assignment membership in archetypes and their architecture management groups; direct assignments are shown rather than asserting deployment or enumerating all inherited descendants. Enforcement mode and excluded scopes are shown separately.

Definitions with unchanged contents can still appear when their assignment context changes. README additions, updates, and removals are excluded from report entries and totals. Other supporting configuration and documentation updates remain visible but are flagged when semantic interpretation is unavailable. A version-only update does not imply a changed evaluation rule.

The prototype uses deterministic analysis, not AI-generated claims. Complex expressions, deployment/action details, assignment overrides/selectors, and built-in definitions absent from the release are explicitly marked for source review. Built-in version selectors such as `2.*.*` are reported as version selections, not exact resolved versions. Links to commit-pinned definitions and GitHub source comparisons replace inline raw JSON diffs. GitHub comparison views can have their own display limits; the pinned source links remain available.

Added, updated, and removed items have distinct, high-contrast icons with screen-reader labels and hover descriptions. Icons have no backgrounds: green for added, blue for updated, red for removed, and orange for deprecated. Multiple icons appear side by side. Policies and initiatives explicitly marked with `properties.metadata.deprecated: true` show a deprecation icon; deprecation is not inferred from removals. When the definition changes only to add a `-deprecated` version suffix and deprecation announcement metadata, only the deprecation icon is shown. Rules, parameters, and all other definition content must remain unchanged; substantive updates retain both icons. Assignment changes are still explained separately.

Expanded items lead with the change summary, including when the definition itself is unchanged. Assignment changes show explicit before/after values only for changed fields, followed by a short list of unchanged settings. Full assignment context and source evidence remain below for review.

The UI announces completed comparisons and filtered result counts, preserves selections on errors, and provides retry actions. Compared tags are recorded in the URL as `from` and `to`; refreshing or opening that link restores the selectors and automatically loads the cached report or resumes the existing job. Invalid or unavailable tag pairs produce an explicit error instead of silently comparing other releases. Requests have a 15-second timeout, polling is bounded to 4.5 minutes, and leaving the page cancels requests and polling timers. Retrying an interrupted status check resumes the same queued job. Reduced-motion preferences use static indicators instead of animations; secondary controls and source links have 44px touch targets.

The comparison bar uses two compact, 54px native release pickers with labels beside version values and a centered direction cue, without an enclosing card or duplicated visible tag paths. Full tags remain accessible descriptions. On phones, pickers stack and the action spans the full width. Status icons and version labels sit above full-width policy titles instead of consuming a side column. Reading text and search use 16px type, search fills the available width, and safe-area padding protects content in portrait and landscape. Tablet layouts retain paired release selectors while giving report controls and titles room to wrap. Search is the only report-filtering control; there are no item-type or change-type selectors.

Large reports render assignment details only when their native disclosure is opened. Search text is indexed once per report rather than rebuilt on every keystroke; filtering retains open items and a new comparison resets them. Change totals and generation time share one compact metadata block without horizontal rules. Motion is limited to quick control feedback and disclosure chevrons. There are no page-load reveals or decorative looping indicators, and reduced-motion preferences disable these transitions.

Report schema version 5 is part of the cache key, so older reports (including those missing deprecation-only classification) are not reused. Polling an old job returns an explicit instruction to start a new comparison rather than serving an incompatible report.
