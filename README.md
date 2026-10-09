# Landing Zone Release Brief

Landing Zone Release Brief compares published Azure Landing Zones Library releases and
produces deterministic, human-readable reports for Azure Landing Zones (ALZ,
`platform/alz/`) and Sovereign Landing Zone (SLZ, `platform/slz/`). Choose a
library above the release pickers; comparisons always stay within that library,
and the last selected pair is remembered separately for each.

SLZ reports resolve each release's pinned ALZ dependency and include inherited
policy changes relevant to SLZ, with evidence linked to the correct immutable
commits. Unrelated ALZ changes are excluded. The tool does not inspect Azure
environments or certify upgrade safety.

See [CONTRIBUTING.md](CONTRIBUTING.md) for local setup and development. For
implementation details and report behavior, see the
[technical overview](docs/TECHNICAL_OVERVIEW.md).
