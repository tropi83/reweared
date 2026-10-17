---
name: autonomous-delivery
description: Use when asked to continue the roadmap on your own (a backend phase plan, a dated plan in docs/superpowers/plans) — how to pick the next task, decide what is yours and what is the owner's, brainstorm only what is open, implement test-first, verify, commit, keep the plan's Progress current and open the PR, with the stop conditions that keep it safe.
---

# Autonomous delivery

The method behind "continue the work" in this repo. It mirrors the brainstorm → plan → TDD → verify loop of the Superpowers plugin (third-party, by obra — not an Anthropic plugin); if that plugin is enabled, its `brainstorming`, `test-driven-development` and `verification-before-completion` skills may be used for the matching steps, but nothing here depends on it.

## Loop (one task of a plan at a time)

1. **Orient.** Read the plan's _Progress_ section, the task, the skills the plan names (`backend`, `security-review`, `testing`, `git-workflow`, `release`, `code-conventions`) and `git status`. Branch from the current stack tip, never from or onto `main` unless the owner says so. One branch per coherent chunk; Conventional Commits; the attribution line the session gives.
2. **Classify the task.**
   - _Mine_: code, tests, CI, scripts with `--dry-run`, docs, runbooks — verifiable locally or in CI.
   - _Owner's_: anything needing a real server, DNS, a paid account, a real provider key, a deploy, a restore over live data, a secret value, or one of the plan's open decisions (D1…). Prepare the script/runbook and its tests, then stop and list exactly what the owner must do or decide.
3. **Brainstorm only what is open.** If the plan already decides, do not re-litigate (CLAUDE.md, `project-context` "Decisions already taken"). If a real choice remains, write the options in two or three lines each with a recommendation, pick the one that keeps the security rules, record it in the plan or an ADR, and say so in the report. Ask the owner only when the choice is irreversible, costs money, or changes a public contract.
4. **Test first.** A failing test (Vitest unit, Testcontainers integration, script `--dry-run`, compose check) before the code. A security rule gets a test that fails when the protection is removed.
5. **Implement small.** Match the surrounding code; no new dependency without noting why (and checking the official docs, with the date, per CLAUDE.md); no secret in git, logs, images or CI output.
6. **Verify before claiming done.** `pnpm check`; `pnpm rust:check` if Rust changed; `pnpm test:integration` and, for stack/compose changes, `pnpm stack:up && pnpm smoke:server` then `pnpm stack:down`. Report real results; if something fails or was skipped, say so.
7. **Close the task.** Update docs in the same change (README, ARCHITECTURE, SECURITY, PRIVACY, DEVELOPMENT, BUILDING, skills, CHANGELOG `[Unreleased]`), tick the task and write the commit hash and any deviation in the plan's _Progress_, commit.
8. **Hand back.** When the branch is coherent: push, open the PR on the previous stack branch (stacked PRs, see `git-workflow`), enable Auto-fix only if the owner agreed, and name the next action on its own line.

## Stop and ask when

- The next step is _Owner's_ (step 2), irreversible, outward-facing (publishing, sending, deploying, DNS, money) or touches `main`.
- A required fact is missing and cannot be verified from the repo or the official docs (never invent endpoints, parameters or model capabilities).
- A check fails twice for a reason you cannot explain — report the output instead of working around it (no `--no-verify`, no weakened test, no disabled lint rule).
- The change would loosen a non-negotiable (CLAUDE.md): provider keys outside the worker, unscoped data access, credits outside the ledger, credentials in logs, a new outbound host without SECURITY.md.

## Reporting

End each stretch with: what is true now (commits, checks run and their results), what is not done or not verified, the owner's pending decisions/actions, and the next command or step.
