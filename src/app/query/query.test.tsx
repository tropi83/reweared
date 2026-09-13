/** Provider metadata through TanStack Query: cached model lists and auth statuses, invalidated by auth-store.refresh(). */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { __setServices, createServices, getServices } from "@/app/services";
import { useAuthStore } from "@/app/stores/auth-store";
import { applyJobUpdate, buildRequestForJob, persistJobResult } from "@/app/stores/generation-store";
import { IndexedDbStorage } from "@/infrastructure/storage/IndexedDbStorage";
import { queryWrapper, resetQueryClient } from "@/test/render";
import { authStatusSnapshot, fetchAuthStatus, useAuthStatus } from "./auth-status";
import { queryKeys } from "./keys";
import { ensureModels, modelsSnapshot, useModels } from "./models";
import { getQueryClient } from "./query-client";

describe("provider metadata queries", () => {
  const storage = new IndexedDbStorage("query-test");
  beforeAll(async () => {
    __setServices(null);
    createServices({ buildRequest: buildRequestForJob, persistResult: persistJobResult, onJobUpdate: applyJobUpdate, storage });
    await storage.init();
  });
  beforeEach(() => resetQueryClient());
  afterEach(() => vi.restoreAllMocks());

  it("fetches a provider's models once and serves the cache afterwards", async () => {
    const mock = getServices().providers.get("mock")!;
    const getModels = vi.spyOn(mock, "getModels");
    const first = renderHook(() => useModels("mock"), { wrapper: queryWrapper });
    await waitFor(() => expect(first.result.current.models.length).toBeGreaterThan(0));
    const second = renderHook(() => useModels("mock"), { wrapper: queryWrapper });
    expect(second.result.current.models).toEqual(first.result.current.models);
    expect(await ensureModels("mock")).toEqual(first.result.current.models);
    expect(modelsSnapshot("mock")).toEqual(first.result.current.models);
    expect(getModels).toHaveBeenCalledTimes(1);
  });

  it("returns an empty list for an unknown provider without throwing", async () => {
    expect(await ensureModels("nope")).toEqual([]);
    expect(modelsSnapshot("nope")).toEqual([]);
  });

  it("degrades a failing auth status check to 'none'", async () => {
    const mock = getServices().providers.get("mock")!;
    vi.spyOn(mock, "getAuthStatus").mockRejectedValue(new Error("boom"));
    expect(await fetchAuthStatus("mock")).toEqual({ state: "unauthenticated", kind: "none" });
    const { result } = renderHook(() => useAuthStatus("gemini"), { wrapper: queryWrapper });
    await waitFor(() => expect(result.current?.state).toBeDefined());
    expect(authStatusSnapshot("gemini")).toEqual(result.current);
  });

  it("auth-store.refresh() invalidates auth statuses and model lists", async () => {
    await ensureModels("mock");
    getQueryClient().setQueryData(queryKeys.authStatus("mock"), { state: "unauthenticated", kind: "none" });
    await useAuthStore.getState().refresh();
    expect(getQueryClient().getQueryState(queryKeys.models("mock"))?.isInvalidated).toBe(true);
    expect(getQueryClient().getQueryState(queryKeys.authStatus("mock"))?.isInvalidated).toBe(true);
  });
});
