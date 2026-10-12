import { useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import { creditsDto } from "@aiv/contracts/credits";
import { platformDto } from "@aiv/contracts/platform";
import { getServices } from "@/app/services";
import { queryKeys } from "./keys";
import { getQueryClient } from "./query-client";

export type Credits = z.infer<typeof creditsDto>;
export type PlatformInfo = z.infer<typeof platformDto>;

/** API mode only: the account's credits (`GET /api/v1/credits`). */
export async function fetchCredits(): Promise<Credits> {
  const api = getServices().api;
  if (!api) throw new Error("Credits exist in API mode only");
  return api.client.get("/api/v1/credits", creditsDto);
}

/** API mode only: run costs and the image model's choices (`GET /api/v1/platform`, public). */
export async function fetchPlatform(): Promise<PlatformInfo> {
  const api = getServices().api;
  if (!api) throw new Error("Platform info exists in API mode only");
  return api.client.get("/api/v1/platform", platformDto);
}

// The balance moves with every run: it is refetched on the job events, never kept 5 minutes.
const creditsOptions = { queryKey: queryKeys.credits, queryFn: fetchCredits, staleTime: 0 };
const platformOptions = { queryKey: queryKeys.platform, queryFn: fetchPlatform };

export function useCredits(enabled = true): { credits: Credits | undefined; error: unknown } {
  const { data, error } = useQuery({ ...creditsOptions, enabled: enabled && !!getServices().api });
  return { credits: data, error };
}

export function usePlatform(enabled = true): PlatformInfo | undefined {
  return useQuery({ ...platformOptions, enabled: enabled && !!getServices().api }).data;
}

/** Synchronous cache reads for the stores' readiness checks; undefined until fetched. */
export function creditsSnapshot(): Credits | undefined {
  return getQueryClient().getQueryData<Credits>(queryKeys.credits);
}

export function platformSnapshot(): PlatformInfo | undefined {
  return getQueryClient().getQueryData<PlatformInfo>(queryKeys.platform);
}

/** A run was charged or refunded (started, or a job ended): the balance shown is stale. */
export function invalidateCredits(): void {
  if (!getServices().api) return;
  void getQueryClient().invalidateQueries({ queryKey: queryKeys.credits });
}

/** The credits a "Create the listing" run costs: one image run per shot plus the copy, at the platform's prices. */
export function listingRunCost(platform: PlatformInfo, shotCount: number): number {
  return platform.runCost.image * shotCount + platform.runCost.copy;
}
