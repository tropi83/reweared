---
name: code-conventions
description: Use when writing or reviewing TypeScript/React/Rust code in this repo — naming, layering, error handling, i18n, React 19 hook rules, formatting/lint commands, and the clean-code checklist to apply before finishing.
---

# Code conventions

## Layering (strict)

`@aiv/domain` (`packages/domain`) → nothing but itself. `infrastructure` → `@aiv/domain`, `src/lib`. `app` → `infrastructure`, `@aiv/domain`. `features` → `app`, `components`, `i18n`. Never import `features` from `app`/`infrastructure`. No React in `domain`/`infrastructure` (React hooks in `app`: `useImageUrl` and the TanStack Query hooks in `app/query`).

The domain is shared with the server (ADR 0001): it lives in the workspace package `packages/domain` (`@aiv/domain`) and must stay free of I/O, DOM globals, React, Tauri and storage libraries — the ESLint block for `packages/domain/src/**` (`no-restricted-imports`, `no-restricted-globals`) and its DOM-less `tsconfig` enforce it. Import it by subpath: `@aiv/domain/models`, `@aiv/domain/services/<file>`, `@aiv/domain/lib/<file>` (no root barrel); inside the package use relative imports. The `@/` alias is the app only it. Server code (`apps/server`, phase 1+) follows the same TypeScript and lint rules; see the `backend` skill for its own layering.

## TypeScript

- `strict` + `noUncheckedIndexedAccess`: handle `undefined` from index access explicitly.
- `interface` for object shapes, `type` for unions. Export domain types from `packages/domain/src/models/index.ts`.
- No `any`. Cast only at boundaries (JSON from Google, Tauri `invoke`) and validate.
- Optional fields: conditional spreads `...(x ? { x } : {})` rather than assigning `undefined`.
- Errors: throw `AppError(code, userMessage, { detail, retryable, retryAfterMs })`. `detail` is for diagnostics — never a credential, never an image, never a full prompt.
- Ids: `createId("lst" | "img" | "gen" | "job" | "rcp")` (older `prj_` listing ids stay valid); call `assertSafeId()` before any filesystem path, DB key or object-storage key.
- Async loaders that memoize must memoize the **promise** (see `load()` in the credential providers), not a boolean flag.

## React

- Function components + hooks; zustand selectors `useStore((s) => s.x)` — never return a fresh object/array from a selector (derive with `useMemo`).
- React 19 lint: no synchronous `setState` inside `useEffect`. To react to prop changes use the "adjust state during render" pattern: `if (prev !== value) { setPrev(value); setX(...) }`.
- All text through `t("key")` / `useT()`; add keys to `en.ts` (source) and `fr.ts`. Key format `feature.thing`.
- Accessibility: `aria-label` on icon-only buttons, native `<dialog>` via `Dialog`, `role="radiogroup"` for choice groups, keyboard reachable.
- Tailwind 4 tokens from `globals.css` (`bg-bg`, `text-fg-muted`, `border-border`, `text-accent`…). No hard-coded colors outside the lightbox and the mock renderer.
- Keep components small; side-effecting logic lives in stores, not JSX.

## Rust

- Commands return `Result<T, String>`; no `unwrap()` on user-influenced data; never log secret values.
- Closed allowlists for anything the webview can name (secret keys, ports). Every new command gets a capability + SECURITY.md review.

## Formatting & lint

`pnpm format` (Prettier 160 cols + Tailwind class sorting) · `pnpm lint` (ESLint + react-hooks + the repo rule `local/no-french-identifiers`) · `pnpm typecheck` · `cargo fmt` · `cargo clippy -- -D warnings`.

**Identifiers are English, prose may be French.** `tools/eslint-rules/no-french-identifiers.js` fails the lint on any declared name (variable, function, class, interface, type, enum, class member) containing a French word — compared by whole word of the camelCase/snake_case split against a root list + endings, never by substring. Comments and strings are not checked. To extend the list, add a root that is neither an English word nor the prefix of one (`categorie` + s = "categories" is the trap), and add a case to `no-french-identifiers.test.mjs`. The domain vocabulary is `Listing` (the item being sold; was `Project`), `Category`/`Subcategory` (the catalogue), `ListingCopy` (title + description).
`pnpm check` runs every JS gate; `pnpm rust:check` the Rust ones. CI runs both.

## Clean-code checklist before finishing

1. No dead code, no commented-out blocks, no `console.*` (use `createLogger`). `pnpm knip` (part of `pnpm check`) fails on unused files, exports and dependencies; an export kept on purpose for an external reader gets a `@public` JSDoc tag, never a blanket ignore.
1. No import cycles between a view and the sections it renders: shared primitives live in their own module (`features/settings/SettingsPrimitives.tsx`, not `SettingsView`).
1. No duplicated logic across stores/components — extract to `lib/` or a store action.
1. Names say what, comments say why. JSDoc on exported functions with non-obvious behaviour.
1. New behaviour has a test; changed behaviour has an updated test.
1. `pnpm check` is green; UI changes were looked at in the browser or the desktop app.
1. Docs updated when architecture, permissions, env vars or user-facing flows change — README, ARCHITECTURE, SECURITY, PRIVACY, DEVELOPMENT, BUILDING, the skills, `CHANGELOG.md` `[Unreleased]`; a structural decision gets an ADR in `docs/adr/`.
