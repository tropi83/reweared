# AI Image Variations — agent instructions

Local-first workspace for AI image variations: React 19 + TypeScript 6 + Vite 8 + Tailwind 4 frontend, Tauri 2 (Rust) shell, Google Gemini provider (BYOK). Read [ARCHITECTURE.md](ARCHITECTURE.md) before structural changes; [SECURITY.md](SECURITY.md) before touching auth, storage, permissions or network.

## Non-negotiables

- **No proprietary backend.** Requests go from the user's device straight to Google. Never add a server, proxy, analytics endpoint or telemetry.
- **Never log, display or persist credentials in clear text.** Logging goes through `src/lib/logger.ts` (redacting). API keys and OAuth tokens live in `SecretStore` only (OS keychain on desktop). Web storage of a key is opt-in and behind the disclaimer.
- **Images leave the device only on Generate**, directly to the configured provider.
- **Google/Tauri APIs: verify the official docs before changing anything** (Interactions API, model ids/capabilities, OAuth, API keys, Tauri plugins). Do not invent endpoints or parameters. Update `GeminiModels.ts` + `DEVELOPMENT.md` when Google changes something, and note the verification date.
- **Minimum Tauri permissions**: every entry in `src-tauri/capabilities/default.json` needs a justification in `SECURITY.md`. New outbound hosts must be added to `ALLOWED_HOSTS` (http-client.ts), the Tauri `http` scope and the CSP `connect-src` together.
- **Never send a parameter a model does not support** — capabilities are centralized in the provider's models catalogue and filtered by `buildRequestForModel`.

## Layout

`src/domain` (pure models/services, no I/O) → `src/infrastructure` (storage, providers, auth, image, http) → `src/app` (services container, zustand stores, router) → `src/features` (React UI) · `src-tauri/src` (keychain + OAuth loopback commands only).

## Workflow

1. Read the relevant skill in `.claude/skills/` (`project-context`, `code-conventions`, `security-review`, `testing`, `git-workflow`, `release`, `tanstack-query` for fetched provider metadata).
2. Implement with tests (Vitest, colocated `*.test.ts(x)`; Rust `#[cfg(test)]`). No CI test may need a Google account — use `MockImageProvider` and `fake-indexeddb`.
3. Before claiming done: `pnpm check` (typecheck + lint + prettier + tests) and `pnpm rust:check` when Rust changed. Run the app (`pnpm dev` / `pnpm tauri dev`) for UI changes.
4. Commit with Conventional Commits; never commit `.env`, keys, tokens, screenshots containing credentials.

## Conventions (summary)

TypeScript strict + `noUncheckedIndexedAccess`; Prettier (160 cols); ESLint with `react-hooks` (React 19 rules — no `setState` directly in effects, use the "adjust state during render" pattern); all user-facing text through `src/i18n` (`en.ts` is the source, `fr.ts` overrides); errors are `AppError` with a `GenerationErrorCode`; ids from `createId()` and validated with `assertSafeId()` before building any path.

<!-- ccgh:begin — written by ccgh init; edits inside are overwritten -->

## The ccgh lifecycle

This repository develops itself through the ccgh plugin. Its specifications, brainstorms,
decisions, tasks and fixes live in `docs/ccgh-bridge/`, grouped by domain and iteration, and their
shape is enforced by `ccgh validate`. Decision records under `<domain>/decisions/` carry the
reasoning behind anything surprising, and `<domain>/fixes/` records every repair and why it was
needed: read the ones for the domain you are touching before changing it.

An iteration is scaffolded with `/ccgh:open-iteration <domain>/<slug>`, recorded with
`/ccgh:write-brainstorm` and `/ccgh:write-spec`, broken into tasks with
`/ccgh:decompose-into-tasks`, validated with `/ccgh:validate-iteration <domain>/<iteration>`
and launched with `/ccgh:launch-iteration <domain>/<iteration>`. When every task is merged it
is shipped with `/ccgh:ship-iteration <domain>/<iteration>`, which opens the pull request into
`main` carrying a `Closes` line for every task. A change too small to specify is a fix, opened
with `/ccgh:open-fix <domain>/<slug>` and committed together with the code it records.

### Taking a request for work

When asked for a change, decide before touching anything, and say it in one line — "a fix in
`listings`", "an iteration in `billing`, a new domain" — then proceed without waiting:

- A change to one or two files that takes no decision is a fix. Anything else is an
  iteration: several files, a choice between approaches, work someone else would need
  explained.
- The domain is the existing one that owns the code the work touches; list `docs/ccgh-bridge/` to
  see them. When none does, create one with `ccgh scaffold domain <name>` in the worktree of the
  work, and replace the summary it leaves with one sentence saying what the domain owns. It
  travels in the same pull request as the work, where it can be refused.

A repository that has just run `ccgh init` has one domain, `ccgh`, holding the iteration that
adopts it; that iteration is validated and launched before any other work reaches `main`.

Validation and launch are human gates: those two skills cannot be invoked by the model, only
typed by a human.

Issues are created by the bridge, never by hand, and closed by the merge into `main`, never by
hand either. Never write `status`, `issue`, `pr`, `validated_by`, `launched_by` or anything
under `github:`. `status` is written by the promotion script, which requires human approval;
the rest is written by the GitHub bridge.

Code that reaches `main` belonging to neither an iteration nor a fix is refused, by a hook
locally and by the validation workflow in CI.

### Git

Isolation comes from git worktrees. One worktree per iteration and per fix, task branches
inside their iteration's worktree, every worktree in `../worktrees/` next to the clone and
named after its branch with slashes turned into dashes, removed once its pull request is
merged. The clone itself stays on `main`. The lifecycle skills create the worktree.

Never commit directly to `main`, and never commit files belonging to two different iterations.

Merge every pull request with `gh pr merge --merge`. Never squash and never rebase-merge: both
rewrite commits, which forces every branch stacked on the merged one to be rebased, and both
collapse the step-by-step history a task's commits record.

### Decisions

Notify before acting, never after, when a change: adds a dependency, alters a public contract,
chooses between approaches the specification did not cover, reaches outside the scope of the
task, modifies `.claude/` or `CLAUDE.md`, or deletes or disables a test.

### Handing back

End every step of the workflow by naming the next action as the command to type, on its own
line. `/ccgh:launch-iteration <reference>`, not "the iteration then has to be launched".

The lifecycle has several human gates — validation, launch, merging a pull request — and the
state after each one cannot be read off the output. A report that says what happened without
saying what comes next leaves the reader guessing which gate they are standing at. When nothing
is required, say that too.

<!-- ccgh:end -->
