/**
 * "Create the listing": photos and text in parallel through the stores, with the Mock image provider,
 * a fake copy provider and in-memory IndexedDB. Image decoding is stubbed (jsdom has no canvas).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/image/image-processing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/infrastructure/image/image-processing")>();
  const fakeBitmap = { width: 640, height: 480, close: () => undefined } as unknown as ImageBitmap;
  return {
    ...actual,
    decodeImage: async () => ({ bitmap: fakeBitmap, width: 640, height: 480 }),
    createThumbnail: async () => new Blob([Uint8Array.from([1, 2, 3])], { type: "image/webp" }),
    prepareForProvider: async (blob: Blob) => ({ blob, mimeType: "image/jpeg" as const, width: 640, height: 480 }),
  };
});

import { AppError, type GenerationJob } from "@/domain/models";
import type { ListingCopyProvider, ListingCopyRequest } from "@/domain/services/listing-copy";
import { IndexedDbStorage } from "@/infrastructure/storage/IndexedDbStorage";
import { listingReadiness } from "./listing-readiness";
import { ensureModels } from "./query/models";
import { resetQueryClient, seedAuthStatus } from "@/test/render";
import { __setServices, createServices, getServices } from "./services";
import { useComposerStore } from "./stores/composer-store";
import { applyJobUpdate, buildRequestForJob, persistJobResult } from "./stores/generation-store";
import { useListingSetupStore } from "./stores/listing-setup-store";
import { useListingsStore } from "./stores/listings-store";
import { useSettingsStore } from "./stores/settings-store";

const PNG = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])], { type: "image/png" });

function fakeCopy(fail?: AppError) {
  const requests: ListingCopyRequest[] = [];
  const provider: ListingCopyProvider = {
    id: "gemini",
    displayName: "Fake vision",
    models: [{ id: "fake-vision", label: "Fake" }],
    getAuthStatus: async () => ({ state: "authenticated", kind: "api_key" }),
    describeListing: async (request) => {
      requests.push(request);
      if (fail) throw fail;
      return {
        copy: { title: "Baskets running", description: "Très bon état.", brand: "Adidas", keywords: ["baskets"] },
        providerMeta: { model: "fake-vision" },
      };
    },
  };
  return { provider, requests };
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
}

const jobsOf = () => Object.values(useListingsStore.getState().current?.jobs ?? {}) as GenerationJob[];

describe("generateListing", () => {
  const storage = new IndexedDbStorage("listing-flow-test");
  let copy: ReturnType<typeof fakeCopy>;

  beforeAll(async () => {
    __setServices(null);
    const services = createServices({ buildRequest: buildRequestForJob, persistResult: persistJobResult, onJobUpdate: applyJobUpdate, storage });
    services.mock.setOptions({ latencyMs: 5, scenario: "success" });
    await storage.init();
  });

  beforeEach(async () => {
    copy = fakeCopy();
    __setServices({ ...getServices(), copyProviders: new Map([["gemini", copy.provider]]) });
    resetQueryClient();
    seedAuthStatus("gemini", { state: "authenticated", kind: "api_key" });
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, copyProviderId: "gemini", mannequin: undefined } });
    await useListingsStore.getState().createFromFile(PNG, "baskets.png");
    useListingSetupStore.getState().setCategory({ categoryId: "men", subcategoryId: "shoes" });
    useComposerStore.getState().setProvider("mock");
    await ensureModels("mock");
    useComposerStore.getState().setModel("mock-fast");
  });

  afterEach(async () => {
    await waitFor(() => jobsOf().every((j) => j.status !== "queued" && j.status !== "generating"));
  });

  it("creates photos and text in parallel, forces the seller's brand and applies the mannequin", async () => {
    useListingSetupStore.getState().setBrand("  Nike  ");
    useListingSetupStore.getState().setUseMannequin(true);
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, mannequin: { build: "S", pose: "sitting", skinTone: "olive" } } });

    const report = await useListingSetupStore.getState().generateListing();

    expect(report).toEqual({ photos: "done", text: "done" });
    expect(copy.requests[0]?.brand).toBe("Nike");
    expect(useListingsStore.getState().current?.listing.copy?.brand).toBe("Nike");
    const worn = jobsOf().find((j) => j.shotId === "worn");
    expect(worn?.prompt).toContain("worn by a man with a slim build and olive skin, sitting on a stool,");
    expect(jobsOf().find((j) => j.shotId === "studio")?.prompt).not.toContain("olive skin");
  });

  it("does not apply the mannequin when the toggle is off", async () => {
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, mannequin: { build: "L", pose: "arched", skinTone: "deep" } } });
    await useListingSetupStore.getState().generateListing();
    expect(jobsOf().find((j) => j.shotId === "worn")?.prompt).toContain("worn by a man, standing, framed from the knees down: both feet inside the shoes");
  });

  it("writes the text only when no image provider is usable", async () => {
    useComposerStore.getState().setProvider("cloudflare");
    const report = await useListingSetupStore.getState().generateListing();
    expect(report).toEqual({ photos: "skipped-provider", text: "done" });
    expect(jobsOf()).toHaveLength(0);
  });

  it("makes the photos only when the copy provider is not connected", async () => {
    seedAuthStatus("gemini", { state: "unauthenticated", kind: "api_key" });
    const report = await useListingSetupStore.getState().generateListing();
    expect(report).toEqual({ photos: "done", text: "skipped-provider" });
    expect(copy.requests).toHaveLength(0);
    expect(jobsOf().length).toBeGreaterThanOrEqual(4);
  });

  it("a text failure does not cancel the photos", async () => {
    copy = fakeCopy(new AppError("INVALID_CREDENTIAL", "bad key"));
    __setServices({ ...getServices(), copyProviders: new Map([["gemini", copy.provider]]) });
    const report = await useListingSetupStore.getState().generateListing();
    expect(report?.photos).toBe("done");
    expect(report?.text).toMatchObject({ error: { code: "INVALID_CREDENTIAL" } });
    expect(jobsOf().length).toBeGreaterThanOrEqual(4);
  });

  it("refuses without a complete selection and caps the brand", async () => {
    useListingSetupStore.getState().setCategory(undefined);
    expect(await useListingSetupStore.getState().generateListing()).toBeNull();
    useListingSetupStore.getState().setBrand("x".repeat(80));
    expect(useListingsStore.getState().current?.listing.brand).toHaveLength(60);
    useListingSetupStore.getState().setBrand("   ");
    expect(useListingsStore.getState().current?.listing.brand).toBeUndefined();
  });
});

describe("listingReadiness", () => {
  it("names the first blocker and the skipped parts", () => {
    expect(listingReadiness({ hasImage: false, hasSelection: true, photosReady: true, textReady: true })).toEqual({
      canCreate: false,
      blocker: "composer.needImage",
      skipped: [],
    });
    expect(listingReadiness({ hasImage: true, hasSelection: false, photosReady: true, textReady: true }).blocker).toBe("listing.needCategory");
    expect(listingReadiness({ hasImage: true, hasSelection: true, photosReady: false, textReady: false })).toEqual({
      canCreate: false,
      blocker: "listing.needProviders",
      skipped: ["photos", "text"],
    });
    expect(listingReadiness({ hasImage: true, hasSelection: true, photosReady: true, textReady: false })).toEqual({
      canCreate: true,
      blocker: null,
      skipped: ["text"],
    });
    expect(listingReadiness({ hasImage: true, hasSelection: true, photosReady: true, textReady: true })).toEqual({
      canCreate: true,
      blocker: null,
      skipped: [],
    });
  });
});
