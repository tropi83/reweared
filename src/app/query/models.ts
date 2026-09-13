import { useQuery } from "@tanstack/react-query";
import { getServices } from "@/app/services";
import type { ModelInfo } from "@/domain/models";
import { queryKeys } from "./keys";
import { getQueryClient } from "./query-client";

const NO_MODELS: ModelInfo[] = [];

/** The provider's model list (`getModels` already falls back to the static catalogue when listing fails). */
export async function fetchModels(providerId: string): Promise<ModelInfo[]> {
  const provider = getServices().providers.get(providerId);
  return provider ? provider.getModels() : NO_MODELS;
}

const options = (providerId: string) => ({ queryKey: queryKeys.models(providerId), queryFn: () => fetchModels(providerId) });

export function useModels(providerId: string): { models: ModelInfo[]; isLoading: boolean; error: unknown } {
  const { data, isLoading, error } = useQuery(options(providerId));
  return { models: data ?? NO_MODELS, isLoading, error };
}

/** Imperative access (stores): the cached list, or a fetch when nothing is cached yet. */
export function ensureModels(providerId: string): Promise<ModelInfo[]> {
  return getQueryClient().ensureQueryData(options(providerId));
}

/** Synchronous read of what is cached, for request builders; empty until a fetch landed. */
export function modelsSnapshot(providerId: string): ModelInfo[] {
  return getQueryClient().getQueryData<ModelInfo[]>(queryKeys.models(providerId)) ?? NO_MODELS;
}
