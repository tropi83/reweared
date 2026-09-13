import { QueryClient } from "@tanstack/react-query";

/**
 * One client for the provider metadata queries (model lists, auth statuses). Local-first: nothing refetches on
 * focus or reconnect, so the only network calls are the ones a screen explicitly needs.
 */
export function createQueryClient(overrides: { retry?: number | boolean } = {}): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60_000,
        gcTime: 30 * 60_000,
        retry: overrides.retry ?? 1,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    },
  });
}

let client: QueryClient | null = null;

/** The app-wide client, for callers outside React (stores, request builders). */
export function getQueryClient(): QueryClient {
  client ??= createQueryClient();
  return client;
}

/** Test hook: swap or reset the client between tests. */
export function __setQueryClient(next: QueryClient | null): void {
  client?.clear();
  client = next;
}
