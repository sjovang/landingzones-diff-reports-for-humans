# Landing Zone Release Brief

Landing Zone Release Brief compares published [Azure Landing Zones Library](https://github.com/Azure/Azure-Landing-Zones-Library) releases and
produces deterministic, human-readable reports for Azure Landing Zones (ALZ,
`platform/alz/`) and Sovereign Landing Zone (SLZ, `platform/slz/`). Choose a
library above the release pickers; comparisons always stay within that library,
and the last selected pair is remembered separately for each.

SLZ reports resolve each release's pinned ALZ dependency and include inherited
policy changes relevant to SLZ, with evidence linked to the correct immutable
commits. Unrelated ALZ changes are excluded. The tool does not inspect Azure
environments or certify upgrade safety.

Production builds load anonymous usage and performance statistics from
`https://stats.liasis.dev`, with Do Not Track support enabled. The statistics
script is disabled during local development (`npm run dev`).

Browse [object timelines](./docs/TECHNICAL_OVERVIEW.md#object-timelines) at
`/timelines` to search policies, policy sets, and archetypes and follow their
release history at a stable URL, with explicit gaps for missing cached releases.
Comparison details link to these pages without generating them. After
synchronizing the catalog, run `npm run timelines:generate` to publish timelines separately, or
manually invoke the key-protected Azure Function `POST /api/timelines/generate`.
The Function queues generation and returns 202; monitor its logs for completion.
Missing snapshots do not fail generation or trigger downloads. Hydrate the cache
and regenerate to fill the gaps; changes are never inferred across a gap.

See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup and development. For
implementation details and report behavior, see the
[technical overview](docs/TECHNICAL_OVERVIEW.md).

For local-machine Azure deployment with Azure Developer CLI, see the
[deployment guide](docs/DEPLOYMENT.md).
