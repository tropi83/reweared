# Contributing

Thanks for helping build AI Image Variations. This page is the short version; the skills in `.claude/skills/` hold the detailed conventions and apply to humans as much as to agents.

## Setup

See [DEVELOPMENT.md](DEVELOPMENT.md), and [BUILDING.md](BUILDING.md) for desktop installers, Android and iOS. TL;DR: `pnpm install`, then `pnpm dev` (web) or `pnpm tauri dev` (desktop). The Mock provider lets you work on the whole workflow without a Google account.

## Workflow

1. Open an issue or pick one. Branch from `main`: `feat/<topic>`, `fix/<topic>`, `docs/<topic>`.
2. When fixing a bug, write the failing test first.
3. Run `pnpm check` (and `pnpm rust:check` if you touched `src-tauri`) before pushing.
4. Commit with [Conventional Commits](https://www.conventionalcommits.org/) — see `.claude/skills/git-workflow/SKILL.md`.
5. Open a PR with the template. CI must pass.

## Ground rules

- No telemetry or third-party analytics, ever. The app is moving to accounts and a server ([ADR 0001](docs/adr/0001-backend-accounts-platform-keys.md)): until phase 3 ships, the client keeps its rules — no backend call, credentials leave the device only to the provider they belong to. Server work follows the backend design and the `backend` skill.
- Structural decisions get an ADR in `docs/adr/`; larger features a dated design and plan in `docs/superpowers/`.
- New outbound hosts, permissions or storage locations need a `SECURITY.md` entry.
- User-facing strings go through `src/i18n`.
- Update the docs in the same PR when behaviour, permissions, env vars or flows change (README, ARCHITECTURE, SECURITY, PRIVACY, DEVELOPMENT, BUILDING, skills, CHANGELOG).
- Verify the Google / Cloudflare / Tauri documentation before changing API calls and record the verification date in the code comment or in `DEVELOPMENT.md`.

## Reporting security issues

Do not open a public issue for vulnerabilities; contact the maintainer directly (see the repository profile). Never include keys or tokens in reports.
