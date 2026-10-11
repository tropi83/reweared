# Backend phase 0 — ADR, transition docs, pnpm workspace, `packages/domain` — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Resuming?** Read the "Progress" section at the bottom first: it says which tasks are done (with commits) and any deviation from the text below.

**Goal:** Record the backend pivot (ADR + transition rules in the agent docs) and extract the pure domain into a workspace package `@aiv/domain` that a Node server can import, **with no behaviour change** for the web, desktop and mobile apps.

**Architecture:** pnpm workspace whose root package stays the web/Tauri app (`src/`, unchanged location). `packages/domain` is a source-only TypeScript package (no build step: Vite, Vitest and `tsc` consume the `.ts` files through `exports`). It contains today's `src/domain/{models,services}` plus the two pure helpers it depends on (`src/lib/ids.ts`, `src/lib/retry.ts`). Its own `tsconfig` has **no DOM lib** and its tests run in a **Node** Vitest project: that is the proof the server can use it.

**Tech Stack:** pnpm 10 workspaces, TypeScript 6 (strict, `noUncheckedIndexedAccess`, `moduleResolution: bundler`), Vite 8, Vitest 4 (`test.projects`), ESLint 9 flat config, knip 5.

**Spec:** `docs/superpowers/specs/2026-10-11-backend-queue-accounts-design.md` (§0 decisions and §2 layout are binding; §10 phase 0 row is this plan).

## Global Constraints

- Branch `docs/backend-architecture` (already holds the spec commit `585cb90`). Conventional Commits; every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Baseline: 48 test files, 311 tests, all green** (2026-10-11). After every task: `pnpm check` green and **311 tests** (the file count may grow when tests are split; the test count may not drop).
- Format touched files with `pnpm exec prettier --write <files>`. Windows shell note: the Bash tool corrupts long heredocs — write files with the Write tool.
- No runtime change: same UI, same storage, same network calls, same Tauri permissions. `src-tauri/` is not touched (so `pnpm rust:check` is not required, but run it once at the end).
- Package name `@aiv/domain` (the repo already uses the `aiv` prefix: `__aivPrefill`, `aiv-workers-ai`). Subpath imports only, no barrel at the package root: `@aiv/domain/models`, `@aiv/domain/services/<file>`, `@aiv/domain/lib/<file>`.
- `packages/domain` may import nothing but itself and the standard library: no `react`, `@tauri-apps/*`, `idb`, `zustand`, `@/…`, no DOM globals (`window`, `document`, `FileReader`, `createImageBitmap`, `localStorage`). `Blob`, `AbortSignal`, `crypto`, `btoa`, `fetch` types come from `@types/node` (they are Node 22 globals).

## Decisions taken in this plan (beyond the spec)

1. **The root stays the web app in phase 0.** The spec's `apps/web/` move touches Vite, Tauri (`frontendDist`, `beforeDevCommand`), CI and every doc for no functional gain now. It is reconsidered at the start of phase 1 when `apps/server/` appears; until then `pnpm-workspace.yaml` lists `packages/*` and the root.
2. **SECURITY.md and PRIVACY.md are not rewritten yet.** They describe what the shipped app does, and the shipped app stays local-first until phase 3. They get a short "Planned change" banner pointing at the ADR; the full rewrite happens in the phase that changes the behaviour (phase 1 for the server, phase 3 for the clients).
3. **`src/lib/logger.ts` stays in the app for now.** The domain does not log. It moves (redaction patterns shared with pino) in phase 1, when the server needs it.
4. **Domain tests that exercise infrastructure move to infrastructure.** `listing-copy.test.ts` tests the Cloudflare and Gemini copy providers, `models.test.ts` checks `GEMINI_IMAGE_MODELS`: those parts belong next to the adapters (and `packages/domain` cannot import them).

## File map

| File                                                                          | Change                                                                                           |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `docs/adr/0001-backend-accounts-platform-keys.md` (new)                       | The pivot decision, context, consequences, superseded rules                                      |
| `CLAUDE.md`, `.claude/skills/project-context/SKILL.md`                        | Transition rules: current client rules still apply to `src/`; server rules for what comes next   |
| `SECURITY.md`, `PRIVACY.md`, `README.md`                                      | "Planned change" banner → ADR                                                                    |
| `src/infrastructure/providers/{cloudflare,gemini}/*ListingCopy.test.ts` (new) | Provider tests moved out of `src/domain/services/listing-copy.test.ts`                           |
| `src/infrastructure/providers/gemini/GeminiModels.test.ts` (new)              | Catalogue tests moved out of `src/domain/models/models.test.ts`                                  |
| `pnpm-workspace.yaml` (new)                                                   | `packages: ["packages/*"]`                                                                       |
| `packages/domain/{package.json,tsconfig.json}` (new)                          | Source-only package, `exports` map, Node-only types                                              |
| `src/domain/**` → `packages/domain/src/{models,services}/**`                  | `git mv`, relative imports inside the package                                                    |
| `src/lib/{ids,retry}.ts` → `packages/domain/src/lib/`                         | `git mv`; their tests split out of `src/lib/lib.test.ts`                                         |
| ~96 files under `src/`                                                        | `@/domain/…` → `@aiv/domain/…`, `@/lib/ids` / `@/lib/retry` → `@aiv/domain/lib/…`                |
| `vite.config.ts`                                                              | `test.projects`: `app` (jsdom, unchanged) + `domain` (node)                                      |
| `package.json`                                                                | `@aiv/domain: workspace:*`, `typecheck` runs both tsconfigs                                      |
| `eslint.config.js`                                                            | `packages/**` covered; `no-restricted-imports` + `no-restricted-globals` boundary for the domain |
| `knip.json`                                                                   | `workspaces` config                                                                              |
| `ARCHITECTURE.md`, `DEVELOPMENT.md`, skills `code-conventions`, `testing`     | New paths                                                                                        |

---

### Task 1: ADR and transition rules

**Files:** Create `docs/adr/0001-backend-accounts-platform-keys.md`. Modify `CLAUDE.md`, `.claude/skills/project-context/SKILL.md`, `SECURITY.md`, `PRIVACY.md`, `README.md`.

- [ ] **Step 1: Write the ADR** (Michael Nygard format): _Status_ Accepted 2026-10-11 · _Context_ (local-first BYOK app; wish for accounts, platform-paid generation, a server-side queue) · _Decision_ (the spec's §0 table, verbatim) · _Consequences_ (positive: no key setup for users, fair queue, multi-device; negative: hosting cost, GDPR controller role, sub-processors Cloudflare/Google/Resend, abuse surface on free credits, the app needs the network) · _Superseded rules_ — list each one with where it lives: CLAUDE.md "No proprietary backend", "Requests go from the user's device straight to Google", "Images leave the device only on Generate, directly to the configured provider"; project-context "No account, no backend, no cloud", "Never add a proxy of ours", "Out of scope: Accounts, cloud sync, backend"; ARCHITECTURE.md principles 1–2 · _Phasing_ (spec §10).
- [ ] **Step 2: CLAUDE.md** — add a section right after the intro:

  ```md
  ## Transition to a backend (ADR 0001, 2026-10-11)

  The product is moving to accounts + a server (`docs/adr/0001-backend-accounts-platform-keys.md`,
  spec `docs/superpowers/specs/2026-10-11-backend-queue-accounts-design.md`). Until phase 3 ships,
  the **shipped clients in `src/` keep every rule below** (local-first, BYOK, no backend calls).
  New server code follows the spec: provider keys only in the worker (Docker secrets), every
  query scoped by the session user, credits reserved and refunded through the ledger, no telemetry
  beyond our own server logs. `packages/domain` stays pure (no I/O, no DOM) — both sides import it.
  ```

  and update the _Layout_ line to start with `packages/domain` (pure models/services/lib, shared) → `src/infrastructure` …

- [ ] **Step 3: project-context skill** — product paragraph: append "Pivot in progress (ADR 0001): accounts, platform keys, server-side queue — see the spec." In _Decisions already taken_, prefix the BYOK / no-proxy bullets with "**Until phase 3:**". In _Out of scope_, remove accounts/backend/cloud sync and add "payment (Stripe comes after credits), collaboration, sharing, marketplace, chat UI, ad SDK". Map row "Domain models / errors" → `packages/domain/src/models/*`.
- [ ] **Step 4: Banners** — top of `SECURITY.md` and `PRIVACY.md` (below the H1), and in README's _Roadmap / status_:

  ```md
  > **Planned change (ADR 0001):** the app is moving to user accounts and a server that runs generations
  > with the platform's provider keys. This document describes the current, local-first release; it will be
  > rewritten when that behaviour ships.
  ```

- [ ] **Step 5:** `pnpm exec prettier --write` on the touched files; `pnpm check` green (311).
- [ ] **Step 6: Commit** `docs(adr): record the move to a backend with accounts and platform keys`.

### Task 2: Move infrastructure tests out of the domain

**Files:** Modify `src/domain/services/listing-copy.test.ts`, `src/domain/models/models.test.ts`. Create `src/infrastructure/providers/cloudflare/CloudflareListingCopy.test.ts`, `src/infrastructure/providers/gemini/GeminiListingCopy.test.ts`, `src/infrastructure/providers/gemini/GeminiModels.test.ts`.

- [ ] **Step 1:** Move `describe("CloudflareListingCopyProvider", …)` (listing-copy.test.ts line ~75) with its imports (`__setFetchOverride`, `LayeredSecretStore`, `MemorySecretStore`, `WebLocalSecretStore`, `CloudflareAuth`, `CloudflareListingCopyProvider`), the `JPEG` / `image` fixtures it uses and the `afterEach(() => __setFetchOverride(undefined))` into `CloudflareListingCopy.test.ts`. Same for `describe("GeminiListingCopyProvider", …)` (~line 122) into `GeminiListingCopy.test.ts`. Copy the fixtures; do not create a shared helper for two 2-line constants. Use relative imports for siblings (`./CloudflareListingCopy`) like the existing `CloudflareProvider.test.ts`.
- [ ] **Step 2:** `listing-copy.test.ts` keeps `describe("listing copy prompt & parsing", …)` and only imports `vitest` + `./listing-copy`.
- [ ] **Step 3:** In `models.test.ts`, move the tests that read `GEMINI_IMAGE_MODELS` (~lines 96–125: request builder on Flash/legacy/Lite, unique ids, capability sanity) into `GeminiModels.test.ts`. If a request-builder test needs a `ModelInfo`, it moves with it — the domain keeps request-builder tests that use an inline `ModelInfo` literal. Check after the move: `grep -rn '@/infrastructure\|@/app\|@/features' src/domain` → **no output**.
- [ ] **Step 4:** `pnpm test` → **311 passed** (50 files). `pnpm check` green.
- [ ] **Step 5: Commit** `test: move provider tests next to their adapters`.

### Task 3: Workspace scaffolding

**Files:** Create `pnpm-workspace.yaml`, `packages/domain/package.json`, `packages/domain/tsconfig.json`. Modify `package.json`.

- [ ] **Step 1:** `pnpm-workspace.yaml`:

  ```yaml
  packages:
    - "packages/*"
  ```

- [ ] **Step 2:** `packages/domain/package.json`:

  ```json
  {
    "name": "@aiv/domain",
    "version": "0.1.0",
    "private": true,
    "type": "module",
    "sideEffects": false,
    "exports": {
      "./models": "./src/models/index.ts",
      "./services/*": "./src/services/*.ts",
      "./lib/*": "./src/lib/*.ts"
    },
    "scripts": { "typecheck": "tsc -p tsconfig.json" }
  }
  ```

- [ ] **Step 3:** `packages/domain/tsconfig.json` — same strictness as the root, **no DOM**:

  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "lib": ["ES2022"],
      "module": "ESNext",
      "moduleResolution": "bundler",
      "allowImportingTsExtensions": true,
      "isolatedModules": true,
      "noEmit": true,
      "skipLibCheck": true,
      "types": ["node", "vitest/globals"],
      "strict": true,
      "noUnusedLocals": true,
      "noUnusedParameters": true,
      "noFallthroughCasesInSwitch": true,
      "noUncheckedIndexedAccess": true
    },
    "include": ["src"]
  }
  ```

  `@types/node` is already in the root `node_modules`; add it to the package's `devDependencies` (`"@types/node": "<same range as root>"`) so the dependency is explicit for knip.

- [ ] **Step 4:** Root `package.json`: `"@aiv/domain": "workspace:*"` in `dependencies`; `"typecheck": "tsc -p tsconfig.json && tsc -p packages/domain/tsconfig.json"`. `pnpm install` (lockfile updated, `node_modules/@aiv/domain` is a symlink). Create `packages/domain/src/.gitkeep` so `tsc -p` has an input dir — removed in task 4.
- [ ] **Step 5:** `pnpm check` green (311). **Commit** `build: add a pnpm workspace with an empty @aiv/domain package`.

### Task 4: Extract the domain (one atomic commit)

**Files:** `git mv` `src/domain/models` → `packages/domain/src/models`, `src/domain/services` → `packages/domain/src/services`, `src/lib/ids.ts` and `src/lib/retry.ts` → `packages/domain/src/lib/`. Modify every importer. Split `src/lib/lib.test.ts`.

- [ ] **Step 1: Move** with `git mv` (history preserved), remove `src/domain/` and `packages/domain/src/.gitkeep`.
- [ ] **Step 2: Imports inside the package become relative.** `@/domain/models` → `../models` (from `services/`) or `./…` (inside `models/`); `@/domain/services/x` → `./x` / `../services/x`; `@/lib/retry` → `../lib/retry`; `@/lib/ids` → `../lib/ids`. Check: `grep -rn 'from "@/' packages/domain` → **no output**.
- [ ] **Step 3: Codemod the app** (Git Bash, GNU sed):

  ```bash
  grep -rlE '"@/domain/|"@/lib/(ids|retry)"' src scripts tools --include=*.ts --include=*.tsx --include=*.mjs \
    | xargs sed -i -E 's#"@/domain/#"@aiv/domain/#g; s#"@/lib/(ids|retry)"#"@aiv/domain/lib/\1"#g'
  ```

  Also `vi.mock("@/domain/…")` strings, if any (`grep -rn "vi.mock(\"@/domain" src` before running). Check: `grep -rnE '@/domain|@/lib/(ids|retry)' src scripts tools` → **no output**.

- [ ] **Step 4: Split `src/lib/lib.test.ts`:** `describe("ids", …)` → `packages/domain/src/lib/ids.test.ts`, `describe("retry helpers", …)` → `packages/domain/src/lib/retry.test.ts`; `lib.test.ts` keeps the logger tests.
- [ ] **Step 5: Vitest projects** in `vite.config.ts` (replace `test.include` / `environment` / `setupFiles`):

  ```ts
  test: {
    globals: true,
    css: false,
    projects: [
      {
        extends: true,
        test: {
          name: "app",
          environment: "jsdom",
          setupFiles: ["./src/test/setup.ts"],
          include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs", "tools/**/*.test.mjs"],
        },
      },
      { test: { name: "domain", environment: "node", globals: true, include: ["packages/domain/src/**/*.test.ts"] } },
    ],
  },
  ```

  Verify the API against the Vitest 4 docs (`test.projects`, `extends: true`) before relying on it — do not guess option names. If a domain test turns out to need a DOM polyfill, fix the test (use Node APIs), not the environment.

- [ ] **Step 6:** `pnpm typecheck` (both tsconfigs) — a DOM type used in `packages/domain` is a real leak: fix it in the domain (e.g. `typeof window` guard → remove) rather than adding `"DOM"` to the package `lib`. `pnpm test` → **311 passed**, with `domain` and `app` projects both listed. `pnpm build` and `pnpm build:prefill` + `pnpm prefill:verify` (the Vinted script imports types from `@aiv/domain/services/publish` now — the generated bundle must be byte-identical, types are erased).
- [ ] **Step 7: Commit** `refactor(domain): extract the pure domain into the @aiv/domain workspace package` — body: why (the server of ADR 0001 imports it), no behaviour change, 311 tests.

### Task 5: Guard the boundary (lint, knip)

**Files:** Modify `eslint.config.js`, `knip.json`, `package.json` (`lint` script).

- [ ] **Step 1:** `lint` script → `eslint src packages tools scripts`. In `eslint.config.js`, the TS block's `files` becomes `["src/**/*.{ts,tsx}", "packages/*/src/**/*.ts"]` (react-hooks rules are harmless on non-React files) and add a block for the domain:

  ```js
  {
    files: ["packages/domain/src/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [
        { group: ["@/*", "react", "react-*", "@tauri-apps/*", "zustand", "idb", "@tanstack/*"],
          message: "packages/domain is shared with the server: no app, UI, Tauri or storage imports." },
      ] }],
      "no-restricted-globals": ["error", "window", "document", "localStorage", "sessionStorage", "indexedDB", "FileReader", "createImageBitmap", "navigator"],
    },
  },
  ```

- [ ] **Step 2:** Prove the guard: temporarily add `import { useState } from "react";` to a domain file → `pnpm lint` fails with the message; revert.
- [ ] **Step 3:** `knip.json` → workspaces:

  ```json
  {
    "$schema": "https://unpkg.com/knip@5/schema.json",
    "workspaces": {
      ".": {
        "entry": ["src/**/*.test.{ts,tsx}", "tools/**/*.test.mjs", "scripts/*.mjs"],
        "project": ["src/**/*.{ts,tsx}", "tools/**/*.{js,mjs}", "scripts/**/*.mjs"],
        "ignoreDependencies": ["tailwindcss"]
      },
      "packages/domain": { "entry": ["src/**/*.test.ts"], "project": ["src/**/*.ts"] }
    },
    "ignoreExportsUsedInFile": true
  }
  ```

  Check the knip 5 workspace docs for whether `exports` subpath patterns count as entries; an export only used by the app must not be reported as unused. `pnpm knip` clean.

- [ ] **Step 4:** `pnpm check` green. **Commit** `build(lint): keep @aiv/domain free of app, DOM and Tauri imports`.

### Task 6: Docs for the new paths

**Files:** `ARCHITECTURE.md`, `DEVELOPMENT.md`, `.claude/skills/code-conventions/SKILL.md`, `.claude/skills/testing/SKILL.md`, `.claude/skills/project-context/SKILL.md`, `CLAUDE.md` (_Layout_ only).

- [ ] **Step 1:** `grep -rn 'src/domain\|src/lib/ids\|src/lib/retry\|@/domain' --include=*.md . | grep -v node_modules | grep -v docs/superpowers` — update every hit (dated specs/plans under `docs/superpowers/` are history: leave them).
- [ ] **Step 2:** ARCHITECTURE.md _Layers_: tree starts with `packages/domain/src/{models,services,lib}`; dependency direction `features → app → infrastructure → @aiv/domain`; one line on why it is a package (shared with the future server, Node-tested, no DOM lib). Principles 1–2 get "(until phase 3 — ADR 0001)".
- [ ] **Step 3:** testing skill: the two Vitest projects, where domain tests live, "domain tests run in Node: no DOM polyfills". code-conventions: import style `@aiv/domain/models`, the lint boundary.
- [ ] **Step 4:** prettier, `pnpm check` green. **Commit** `docs: document the @aiv/domain package and its boundary`.

### Task 7: Final verification

- [ ] `pnpm check` → green, **311 tests**, projects `app` + `domain`.
- [ ] `pnpm rust:check` → green (nothing changed there; proves the frontend build Tauri embeds is fine).
- [ ] `pnpm build` then `pnpm dev`: open a listing, run a generation with the **Mock** provider, open Settings → Diagnostics. Same behaviour as `main`.
- [ ] `pnpm tauri dev` starts and shows the listings.
- [ ] Fresh clone check: `git clean -xdn` shows nothing unexpected; `pnpm install --frozen-lockfile` works (CI uses it — the workspace must be in the lockfile).
- [ ] CI unchanged and green on the PR (it calls the root scripts, which now cover the workspace). Open the PR `refactor: phase 0 of the backend — ADR and @aiv/domain package` with "Security impact: none (no runtime change)" and "Docs updated: ADR 0001, CLAUDE.md, skills, ARCHITECTURE, DEVELOPMENT".

## Progress

_Nothing done yet. Update this section after each task: task number, commit hash, deviations._
