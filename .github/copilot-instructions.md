# Commit and pull request conventions

This repository uses release-please to determine release versions and generate
release notes from the history on `main`. Use Conventional Commits for **every
commit subject and every pull request title**.

- Use `<type>[optional scope][!]: <description>`, for example
  `fix: exclude legacy ALZ release` or `docs: document release conventions`.
- Choose the type based on the change: `fix` for bug fixes, `feat` for new
  features, and `docs`, `chore`, `refactor`, `test`, `ci`, `build`, `perf`, or
  `style` when appropriate. Do not label a feature or fix as `chore` or `docs`
  just to avoid a release.
- `fix` normally requests a patch release and `feat` a minor release. Mark
  breaking changes with `!` and explain them in a `BREAKING CHANGE:` footer.
  The actual version bump follows `release-please-config.json`, including its
  pre-1.0 versioning settings.
- Keep the description concise and meaningful. Apply the same format when
  editing an existing pull request title.
- Before creating a commit or opening a pull request, verify its subject or
  title follows this convention. Before merging, ensure the resulting commit
  subject does too; a squash merge commonly uses the pull request title.
- Pull request bodies should explain the change, relevant validation, and any
  breaking changes. A conventional title is required even when the body
  describes the change.

Preserve required co-author trailers when committing. Do not amend or rewrite
existing commits unless explicitly requested.
