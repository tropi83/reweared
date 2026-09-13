# TanStack Query for provider metadata — design

Decided in chat on 2026-09-13 (the recommendation was to stay on zustand; the owner chose a limited
adoption: model lists and auth status). Version: `@tanstack/react-query` 5.102.

## 1. What goes where

| Kind of state                                                                                                   | Owner                                  |
| --------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **Provider metadata fetched from the network and cacheable**: model list per provider, auth status per provider | **TanStack Query**                     |
| User / document state: listings, generations, jobs, settings, composer choices, UI                              | zustand (unchanged)                    |
| Commands with progress (generate, describe, publish)                                                            | stores + `GenerationQueue` (unchanged) |

Nothing else moves. The local-first rules hold: queries only hit the provider endpoints already in the
allow-list (`/models`, auth status checks); no `refetchOnWindowFocus`, no polling.

## 2. Pieces

- `src/app/query/query-client.ts` — `createQueryClient()` (defaults: `staleTime` 5 min, `gcTime` 30 min,
  `retry: 1`, `refetchOnWindowFocus: false`, `refetchOnReconnect: false`), `getQueryClient()` for non-React
  callers, `__setQueryClient()` for tests.
- `src/app/query/keys.ts` — `queryKeys.models(providerId)`, `queryKeys.authStatus(providerId)` and the
  parent keys used for invalidation (`queryKeys.allModels`, `queryKeys.allAuthStatus`).
- `src/app/query/models.ts` — `fetchModels(providerId)` (`provider.getModels()`; unknown provider → `[]`),
  `useModels(providerId)` → `{ models, isLoading, error }` (`data ?? []`), `ensureModels(providerId)` for
  imperative code (`queryClient.ensureQueryData`), `modelsSnapshot(providerId)` (`getQueryData`) for
  synchronous readers.
- `src/app/query/auth-status.ts` — `fetchAuthStatus(providerId)` (image provider first, then copy
  provider; errors → `{ state: "none" }`), `useAuthStatus(providerId)`, `useProviderStatuses()` (one
  `useQueries` over every registered provider), `authStatusSnapshot(providerId)`.
- `auth-store.refresh()` keeps its own credential fields and, after every credential change,
  `invalidateQueries` on `allAuthStatus` and `allModels` (availability depends on credentials). The
  `providerStatus` field of the store is removed.
- `generation-store`: `modelsByProvider`, `modelsLoading`, `loadModels` are removed. `start()` awaits
  `ensureModels`; `buildRequestForJob` reads `modelsSnapshot`.
- `useComposerDefaults` / `useComposerModels` read `useModels`; the "reload models when auth changes"
  effect disappears (invalidation does it).
- `App.tsx` wraps the shell in `QueryClientProvider`. Tests render through `src/test/render.tsx`
  (`renderWithQuery`, a fresh client with `retry: false`) and seed data with `setQueryData` instead of
  `useAuthStore.setState({ providerStatus })`.

## 3. Skill

`.claude/skills/tanstack-query/SKILL.md`: the table above, the key factory, the invalidation points, how
to add a query (fetcher in `src/app/query`, key in `keys.ts`, hook + imperative accessor, test with
`renderWithQuery`), and what must never become a query (documents, secrets, generation jobs).

## 4. Tests

- `src/app/query/query.test.tsx`: models are fetched once per provider and cached; auth status errors
  degrade to `none`; `auth-store.refresh()` invalidates both; `ensureModels` works outside React.
- Existing tests adapted (render wrapper, seeding); behaviour unchanged: 266 tests stay green.
