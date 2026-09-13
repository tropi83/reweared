import type { ReactElement, ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions } from "@testing-library/react";
import { queryKeys } from "@/app/query/keys";
import { __setQueryClient, createQueryClient, getQueryClient } from "@/app/query/query-client";
import type { AuthStatus } from "@/domain/models";

/** Fresh query client (no retries) so a test never sees another test's cache. */
export function resetQueryClient(): void {
  __setQueryClient(createQueryClient({ retry: false }));
}

export function queryWrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={getQueryClient()}>{children}</QueryClientProvider>;
}

/** `render` with the app's QueryClientProvider around the tree. */
export function renderWithQuery(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  return render(ui, { ...options, wrapper: queryWrapper });
}

/** Seeds a provider's auth status in the query cache (what the app would have fetched). */
export function seedAuthStatus(providerId: string, status: AuthStatus): void {
  getQueryClient().setQueryData(queryKeys.authStatus(providerId), status);
}
