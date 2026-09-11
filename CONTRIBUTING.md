# Contributing

Thanks for helping build AI Image Variations. This page is the short version; the skills in `.claude/skills/` hold the detailed conventions and apply to humans as much as to agents.

## Setup

See [DEVELOPMENT.md](DEVELOPMENT.md). TL;DR: `pnpm install`, then `pnpm dev` (web) or `pnpm tauri dev` (desktop). The Mock provider lets you work on the whole workflow without a Google account.

## Workflow

1. Open an issue or pick one. Branch from `main`: `feat/<topic>`, `fix/<topic>`, `docs/<topic>`.
2. When fixing a bug, write the failing test first.
3. Run `pnpm check` (and `pnpm rust:check` if you touched `src-tauri`) before pushing.
4. Commit with [Conventional Commits](https://www.conventionalcommits.org/) — see `.claude/skills/git-workflow/SKILL.md`.
5. Open a PR with the template. CI must pass.

## Ground rules

- No backend, no telemetry; no credential ever leaves the device except to Google.
- New outbound hosts, permissions or storage locations need a `SECURITY.md` entry.
- User-facing strings go through `src/i18n`.
- Verify the Google / Tauri documentation before changing API calls and record the verification date in the code comment or in `DEVELOPMENT.md`.

## Reporting security issues

Do not open a public issue for vulnerabilities; contact the maintainer directly (see the repository profile). Never include keys or tokens in reports.
