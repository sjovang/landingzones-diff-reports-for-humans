# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Engineers who manage Azure architectures and need to evaluate whether to upgrade Azure Landing Zones Library releases.

## Product Purpose

Help engineers make better-informed, more confident upgrade decisions by presenting the differences between Azure Landing Zones Library releases in a human-readable format.

## Positioning

A release comparison tool focused on clear, navigable reports of changes between versions of the Azure Landing Zones Library, rather than raw diffs or changes to deployed Azure resources.

## Operating Context

Users compare releases of the Azure Landing Zones Library published at https://github.com/Azure/Azure-Landing-Zones-Library to understand what changed before deciding whether to upgrade.

## Capabilities and Constraints

- The first release compares published Azure Landing Zones (ALZ) releases under `platform/alz/`; Secure Landing Zones (SLZ), AMBA, and other library members are deferred.
- Users do not need to interact with or modify Azure resources.
- Release information is synchronized hourly from the fixed upstream GitHub repository and stored durably. Page loads and comparisons read the last successful catalog, not the GitHub API.
- Release contents are cached by immutable commit SHA and reused across comparison pairs. Failed syncs retain the last successful catalog; a new install must synchronize before comparisons are available.
- Diff reports can be large and complex, so reports must be cached.
- Reports should be easy to navigate, including collapsible detail sections.
- Reports explain changes to policies, initiatives, and assignments rather than presenting changed files or raw JSON diffs as the result.
- README changes are excluded from report entries and totals; they are not relevant to upgrade decisions.
- Policy explanations prioritize version changes, purpose, changed evaluation rules and parameter defaults, configured effects, and library-defined assignment scopes.
- Scope and effect context is resolved through initiatives, assignments, archetypes, and architectures in both releases. These are library configurations, not a view of deployed Azure resources.
- Raw definitions and diffs are secondary evidence linked on GitHub. Missing built-in definitions and unsupported expressions must be identified explicitly, never guessed.
- The comparison selector defaults to the newest two published ALZ releases and allows selection of other published ALZ tags.
- Generated reports are immutable and privately cached without automatic expiry during the prototype; revisit retention before deployment.

## Brand Commitments

The user wants a clean, simple interface and easy-to-navigate reports.
This is a business tool: motion should make interactions pleasant and clear,
not introduce spectacle or delay work.

## Evidence on Hand

- Upstream source repository: https://github.com/Azure/Azure-Landing-Zones-Library
- No product-specific demonstrations, customer evidence, or testimonials have been provided; do not invent them.

## Product Principles

- Make release changes understandable enough to support upgrade decisions.
- Keep comparisons read-only with respect to users' Azure resources.
- Make large reports navigable and reuse generated reports through caching.
- Never imply that a reported change is safe, deploys successfully, or affects a user's Azure resources.
