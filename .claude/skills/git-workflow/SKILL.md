---
name: git-workflow
description: Use for any git operation in this repo — branch naming, Conventional Commits, what must never be committed, pre-commit gates, PR expectations and the GitHub Actions CI that guards main.
---

# Git workflow

## Branches

`main` is protected by CI. Work on `feat/<topic>`, `fix/<topic>`, `chore/<topic>`, `docs/<topic>`, `ci/<topic>`. Rebase on `main` before opening a PR; no merge commits from `main` into feature branches.

## Commits — Conventional Commits

`<type>(<scope>): <imperative summary>` — types: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`, `security`. Scopes: `queue`, `gemini`, `auth`, `storage`, `ui`, `tauri`, `i18n`, `docs`, `ci`, `deps`.
The body explains **why**. Reference issues with `Refs #12` / `Closes #12`. Atomic commits (one concern), each one green.

```
fix(gemini): stop sending response_format.mime_type

The live Interactions API rejects "image/png" for gemini-3.1-flash-image
even though the docs show it; let the model pick the output format.
```

## Never commit

`.env`, anything matching `client_secret*.json`, API keys/tokens (even in tests or screenshots), `dist/`, `src-tauri/target`, `src-tauri/gen/schemas`, user data from `%APPDATA%`. `.gitignore` covers these — never weaken it.

## Before committing

```bash
pnpm check          # typecheck + lint + prettier + tests
pnpm rust:check     # when src-tauri changed
```

Fix, don't skip. Never `--no-verify`, never force-push `main`.

## Pull requests

Title = Conventional Commit summary. Body: what/why, screenshots for UI, a "Security impact" line (none / describe), a "Docs updated" line. CI (`.github/workflows/ci.yml`) must be green: web checks, Rust checks, web build.

## Releases

See the `release` skill (`vX.Y.Z` tags, CHANGELOG, Tauri build workflow).
