---
name: tanstack-query
description: Use when reading or adding provider metadata (model lists, auth statuses) or any other cacheable, fetched data — what belongs to TanStack Query vs zustand in this repo, the key factory, invalidation points, imperative access from stores, and how to test with renderWithQuery.
---

# TanStack Query in AI Image Variations

`@tanstack/react-query` 5 owns **provider metadata fetched from the network**. zustand owns everything the user
or the app produces. Do not blur the line: a document, a setting, a secret, a generation job or a publish session is
never a query.

| Data                                              | Owner          | Where                                                      |
| ------------------------------------------------- | -------------- | ---------------------------------------------------------- |
| Model list per provider (`provider.getModels()`)  | TanStack Query | `src/app/query/models.ts`                                  |
| Auth status per provider (`getAuthStatus()`)      | TanStack Query | `src/app/query/auth-status.ts`                             |
| Listings, generations, jobs, settings, composer   | zustand        | `src/app/stores/*`                                         |
| Commands with progress (generate, describe, post) | stores + queue | `generation-store`, `listing-setup-store`, `publish-store` |

## Rules

- **Keys come from `src/app/query/keys.ts`** (`queryKeys.models(id)`, `queryKeys.authStatus(id)`, and the parent
  keys `allModels` / `allAuthStatus` for invalidation). Never write a key literal elsewhere.
- **One client**: `getQueryClient()` (`src/app/query/query-client.ts`). Defaults: `staleTime` 5 min, `gcTime`
  30 min, `retry` 1, **no** refetch on focus or reconnect — local-first: the app must not talk to a provider
  because a window was focused. Do not override these per query without a reason written in the code.
- **Each query module exposes three things**: a `fetchX` function (pure I/O, degrades gracefully: unknown
  provider → empty list, failing status → `unauthenticated`), a `useX` hook for components, and an imperative
  accessor for stores (`ensureX` = cached-or-fetch, `xSnapshot` = synchronous cache read). Stores never import
  `useQuery`; they use the accessors.
- **Invalidation points**: `useAuthStore.refresh()` invalidates `allAuthStatus` and `allModels` after any
  credential change (availability depends on credentials). Add a new invalidation only where the underlying data
  actually changes (e.g. a provider setting), and invalidate the parent key.
- **Network rule** unchanged: a query may only call endpoints already in `ALLOWED_HOSTS` / the Tauri `http`
  scope / the CSP; images never leave the device through a query.
- **Errors** are data: `useModels` returns `models: []` + `error`; screens show the hint they already have
  ("connect a provider…"), never a raw exception.

## Adding a query

1. Add the key to `keys.ts` (child key + parent key if a family).
2. Create `src/app/query/<thing>.ts` with `fetchThing`, `useThing`, `ensureThing` / `thingSnapshot` as above.
3. Wire invalidation where the source changes.
4. Test in `src/app/query/*.test.tsx`: fetched once then cached, degraded error, invalidation.
5. Components: render in tests with `renderWithQuery` from `src/test/render.tsx`; seed with `seedAuthStatus`
   or `getQueryClient().setQueryData(queryKeys.x(...), value)`; call `resetQueryClient()` in `beforeEach`.

## Reading the cache outside React

```ts
import { ensureModels, modelsSnapshot } from "@/app/query/models";
import { authStatusSnapshot } from "@/app/query/auth-status";

const models = await ensureModels(providerId); // in an async store action
const ready = authStatusSnapshot(providerId)?.state === "authenticated"; // in a synchronous readiness check
```

`modelsSnapshot` is empty until a fetch landed: components that depend on it must also mount `useModels(id)`
so they re-render when the data arrives (see `ListingSetupCard`).
