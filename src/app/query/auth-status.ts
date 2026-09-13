import { useQueries, useQuery } from "@tanstack/react-query";
import { getServices } from "@/app/services";
import type { AuthStatus } from "@/domain/models";
import { queryKeys } from "./keys";
import { getQueryClient } from "./query-client";

const NONE: AuthStatus = { state: "unauthenticated", kind: "none" };

/** Auth status of an image or copy provider; a failing check reads as "not connected", never as an error screen. */
export async function fetchAuthStatus(providerId: string): Promise<AuthStatus> {
  const { providers, copyProviders } = getServices();
  const provider = providers.get(providerId) ?? copyProviders.get(providerId);
  if (!provider) return NONE;
  return provider.getAuthStatus().catch(() => NONE);
}

const options = (providerId: string) => ({ queryKey: queryKeys.authStatus(providerId), queryFn: () => fetchAuthStatus(providerId) });

export function useAuthStatus(providerId: string): AuthStatus | undefined {
  return useQuery(options(providerId)).data;
}

/** Every registered provider's status, keyed by id (undefined while a status is still loading). */
export function useProviderStatuses(): Record<string, AuthStatus | undefined> {
  const { providers, copyProviders } = getServices();
  const ids = [...new Set([...providers.keys(), ...copyProviders.keys()])];
  return useQueries({
    queries: ids.map(options),
    combine: (results) => Object.fromEntries(ids.map((id, i) => [id, results[i]?.data])),
  });
}

export function authStatusSnapshot(providerId: string): AuthStatus | undefined {
  return getQueryClient().getQueryData<AuthStatus>(queryKeys.authStatus(providerId));
}
