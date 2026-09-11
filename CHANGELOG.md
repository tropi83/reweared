# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- Gemini: requests no longer send `response_format.mime_type` (the live Interactions API rejected `image/png`); the model's default output format is used.
- Auth: concurrent first calls could observe a half-loaded credential (the load promise is now memoized).

### Added

- Prettier, EditorConfig and rustfmt configuration; `pnpm check` / `pnpm rust:check` gates.
- GitHub Actions CI (web checks, Rust checks, secrets scan) and a tag-driven release workflow.
- Unit tests for auth (SecretStore, API key, PKCE, OAuth flow, concurrent refresh), models, lib helpers, router, i18n and stores.
- `CLAUDE.md` and project skills in `.claude/skills`.

## [0.1.0] - 2026-09-11

### Added

- Local-first workspace: import (drop / paste / picker), composer with recipes and `{{variables}}`, independent variation jobs with bounded concurrency, retry with backoff, cancellation and timeouts, progressive results.
- Branching: use a result as source, generate more like this, generate again, edit prompt; history tree persisted per project.
- Gallery: grid, fullscreen with zoom/pan, side-by-side compare, favourites, multi-select, export PNG/JPEG/WebP + ZIP.
- Google Gemini provider (Interactions API) with API key or Google OAuth (desktop, PKCE + loopback) and quota-project selection; Mock provider for development.
- Storage: IndexedDB (web) and filesystem (desktop) with schema versioning; settings, diagnostics, EN/FR.
- Tauri 2 shell with OS keychain secrets, minimum permissions and strict CSP.
