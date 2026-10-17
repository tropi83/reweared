---
name: release
description: Use when cutting a version — bump versions consistently in package.json / tauri.conf.json / Cargo.toml, update CHANGELOG.md, tag, and let the release workflow build the desktop bundles.
---

# Release

1. `main` is green and `CHANGELOG.md` has entries under `## [Unreleased]`.
2. Bump the version in **three** places (they must match): `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`; then `cd src-tauri && cargo update -p ai-image-variations` to refresh `Cargo.lock`.
3. Move the `[Unreleased]` entries under `## [X.Y.Z] - YYYY-MM-DD`.
4. Commit `chore(release): vX.Y.Z`, tag `vX.Y.Z`, push the tag.
5. `.github/workflows/release.yml` builds Windows / macOS / Linux bundles with `tauri-apps/tauri-action` and attaches them to a **draft** GitHub release. Review the notes, then publish.
6. Smoke test an installer built with the production `VITE_API_ORIGIN`: app starts, Settings → About shows the version, sign in → create a listing → generate → close → reopen with the listing still there (it lives on the account).

**Server (planned, backend phase 4):** the api/worker image will be built and pushed by a release workflow and deployed with `docker compose pull && docker compose up -d` after a database backup; migrations run in the `migrate` one-shot service. Not defined yet — the phase 4 plan writes this section.

Never ship an app pointed at the dev stack (`VITE_API_ORIGIN` must be the production https origin) and never embed a secret in a build: the only build-time values are public (`VITE_API_ORIGIN`, version). The Mock provider exists on the server side only and is selected by server configuration, never in a release stack.
