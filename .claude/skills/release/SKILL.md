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

**Server:** pushing the tag `vX.Y.Z` also runs `.github/workflows/server-release.yml`: it builds the `server` and `web` images (`deploy/Dockerfile`, `VITE_API_ORIGIN=/`), scans them with Trivy (fails on fixable critical issues) and publishes them to GHCR as `ghcr.io/<owner>/aiv-server|aiv-web:X.Y.Z` and `sha-<short>` with SBOM and provenance. The server image tag equals the app version; deploy it with `AIV_VERSION=X.Y.Z docker compose pull && docker compose up -d --wait` after a database backup (migrations run in the `migrate` one-shot service). To release only the server, run the workflow by hand (`workflow_dispatch`, `publish` on) — the desktop bundles are a separate workflow. Deployment and rollback scripts: phase 4 task 6.

Never ship an app pointed at the dev stack (`VITE_API_ORIGIN` must be the production https origin) and never embed a secret in a build: the only build-time values are public (`VITE_API_ORIGIN`, version). The Mock provider exists on the server side only and is selected by server configuration, never in a release stack.
