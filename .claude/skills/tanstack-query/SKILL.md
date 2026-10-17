---
name: tanstack-query
description: Use when reading or adding account data fetched from the API (credits, platform info) or any other cacheable, fetched data — what belongs to TanStack Query vs zustand in this repo, the key factory, invalidation points, imperative access from stores, and how to test with renderWithQuery.
---

# TanStack Query in AI Image Variations

`@tanstack/react-query` 5 owns **account data fetched from our API** (credits, platform info). zustand owns everything the user
or the app produces. Do not blur the line: a document, a setting, a secret, a generation job or a publish session is
never a query.

> Listings and the open listing deliberately stay in zustand (`listings-store` behind the `ListingRepository`
> port): an SSE event re-reads the open listing's document (`live-updates.ts`). Do not move listings to Query
> without a plan.

| Data                                              | Owner          | Where                                                      |
| ------------------------------------------------- | -------------- | ---------------------------------------------------------- |
| Credits (`/credits`), platform info               | TanStack Query | `src/app/query/credits.ts`                                 |
| Listings, generations, jobs, settings, composer   | zustand        | `src/app/stores/*`                                         |
| Commands with progress (generate, describe, post) | stores + queue | `generation-store`, `listing-setup-store`, `publish-store` |

## Rules

- **Keys come from `src/app/query/keys.ts`** (`queryKeys.credits`, `queryKeys.platform`). Never write a key literal elsewhere.
- **One client**: `getQueryClient()` (`src/app/query/query-client.ts`). Defaults: `staleTime` 5 min, `gcTime`
  30 min, `retry` 1, **no** refetch on focus or reconnect — the app must not hit the server just because a window
  was focused. Do not override these per query without a reason written in the code.
- **Each query module exposes three things**: a `fetchX` function (pure I/O, degrades gracefully: unknown
  provider → empty list, failing status → `unauthenticated`), a `useX` hook for components, and an imperative
  accessor for stores (`ensureX` = cached-or-fetch, `xSnapshot` = synchronous cache read). Stores never import
  `useQuery`; they use the accessors.
- **Invalidation points**: `invalidateCredits()` after a run starts and
  on terminal job events (the server sends no balance event); credits use `staleTime: 0`; sign-out clears the
  whole cache. Add a new invalidation only where the underlying data
  actually changes (e.g. a provider setting), and invalidate the parent key.
- **Network rule**: a query goes through `ApiClient` (the API origin only); images never travel through a query.
- **Errors** are data: hooks return the error alongside empty data; screens show a user-safe message, never a raw exception.

## Adding a query

1. Add the key to `keys.ts` (child key + parent key if a family).
2. Create `src/app/query/<thing>.ts` with `fetchThing`, `useThing`, `ensureThing` / `thingSnapshot` as above.
3. Wire invalidation where the source changes.
4. Test in `src/app/query/*.test.tsx`: fetched once then cached, degraded error, invalidation.
5. Components: render in tests with `renderWithQuery` from `src/test/render.tsx`; seed with
   `getQueryClient().setQueryData(queryKeys.x, value)`; call `resetQueryClient()` in `beforeEach`.

## Reading the cache outside React

```ts
import { creditsSnapshot, platformSnapshot } from "@/app/query/credits";

const balance = creditsSnapshot()?.balance; // synchronous cache read, e.g. in a readiness check
```

A snapshot is empty until a fetch landed: components that depend on it must also mount the hook (`useCredits()`,
`usePlatform()`) so they re-render when the data arrives (see `ListingSetupCard`).
