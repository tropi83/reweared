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
6. Smoke test an installer: app starts, Settings → About shows the version, a fresh install can import → generate (Mock) → close → reopen with the project still there.

**Server (planned, backend phase 4):** the api/worker image will be built and pushed by a release workflow and deployed with `docker compose pull && docker compose up -d` after a database backup; migrations run in the `migrate` one-shot service. Not defined yet — the phase 4 plan writes this section.

Never ship with the Mock provider enabled (`VITE_ENABLE_MOCK_PROVIDER` unset in release env) and never embed anything but the public Desktop OAuth client documented in DEVELOPMENT.md.
