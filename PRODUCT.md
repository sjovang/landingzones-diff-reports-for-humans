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

- The first release compares library releases; users do not need to interact with or modify Azure resources.
- Diff reports can be large and complex, so reports must be cached.
- Reports should be easy to navigate, including collapsible detail sections.
- The release-selection behavior, report format, and cache policy are undecided.

## Brand Commitments

The user wants a clean, simple interface and easy-to-navigate reports.

## Evidence on Hand

- Upstream source repository: https://github.com/Azure/Azure-Landing-Zones-Library
- No product-specific demonstrations, customer evidence, or testimonials have been provided; do not invent them.

## Product Principles

- Make release changes understandable enough to support upgrade decisions.
- Keep comparisons read-only with respect to users' Azure resources.
- Make large reports navigable and reuse generated reports through caching.
