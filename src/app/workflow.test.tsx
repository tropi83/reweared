/**
 * End-to-end workflow through the stores with the Mock provider and in-memory IndexedDB:
 *   import -> prompt -> generate 4 -> results -> use as source -> generate again -> reload.
 * Image decoding is stubbed because jsdom has no canvas.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/image/image-processing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/infrastructure/image/image-processing")>();
  const fakeBitmap = { width: 640, height: 480, close: () => undefined } as unknown as ImageBitmap;
  return {
    ...actual,
    decodeImage: async () => ({ bitmap: fakeBitmap, width: 640, height: 480 }),
    createThumbnail: async () => new Blob([Uint8Array.from([1, 2, 3])], { type: "image/webp" }),
    prepareForProvider: async (blob: Blob) => ({ blob, mimeType: "image/png" as const, width: 640, height: 480 }),
  };
});

import { __setServices, createServices } from "./services";
import { applyJobUpdate, buildRequestForJob, persistJobResult, useGenerationStore } from "./stores/generation-store";
import { useListingsStore } from "./stores/listings-store";
import { useComposerStore } from "./stores/composer-store";
import { buildShots } from "@/domain/services/catalog";
import { IndexedDbStorage } from "@/infrastructure/storage/IndexedDbStorage";

const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13];

async function waitFor(predicate: () => boolean, timeoutMs = 5000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("core workflow (mock provider)", () => {
  const storage = new IndexedDbStorage("workflow-test");

  beforeAll(async () => {
    __setServices(null);
    const services = createServices({ buildRequest: buildRequestForJob, persistResult: persistJobResult, onJobUpdate: applyJobUpdate, storage });
    services.mock.setOptions({ latencyMs: 5, scenario: "success" });
    services.queue.configure({ concurrency: 2, maxAttempts: 2, timeoutMs: 5000 });
    await storage.init();
  });

  it("imports, generates four variations, branches from a result and survives a reload", async () => {
    const listings = useListingsStore.getState();
    const file = new File([Uint8Array.from(PNG_HEADER)], "shot.png", { type: "image/png" });
    const doc = await listings.createFromFile(file, "shot.png");
    expect(doc.listing.name).toBe("shot");
    expect(doc.listing.originalImageId).toBeDefined();
    expect(await storage.readImage(doc.listing.id, "original", doc.listing.originalImageId!)).not.toBeNull();
    expect(await storage.readImage(doc.listing.id, "thumbnail", doc.listing.originalImageId!)).not.toBeNull();

    useComposerStore.getState().bindListing(doc.listing.id);
    const generation = await useGenerationStore.getState().start({
      sourceImageId: doc.listing.originalImageId!,
      prompt: "make it studio",
      providerId: "mock",
      modelId: "mock-fast",
      aspectRatio: "1:1",
      variationCount: 4,
    });
    expect(generation.jobIds).toHaveLength(4);
    expect(generation.parentGenerationId).toBeUndefined();

    await waitFor(() => useListingsStore.getState().current?.generations[generation.id]?.status === "completed");
    let current = useListingsStore.getState().current!;
    const results = generation.jobIds.map((id) => current.jobs[id]!);
    expect(results.every((j) => j.status === "completed" && j.resultImageId)).toBe(true);
    const resultAssets = results.map((j) => current.images[j.resultImageId!]!);
    expect(resultAssets.every((a) => a.kind === "generation" && a.generationId === generation.id)).toBe(true);
    for (const asset of resultAssets) {
      expect(await storage.readImage(current.listing.id, "generation", asset.id)).not.toBeNull();
    }

    // Use a result as the source of a new branch.
    const branchSource = resultAssets[1]!;
    const branch = await useGenerationStore.getState().start({
      sourceImageId: branchSource.id,
      prompt: "more like this",
      providerId: "mock",
      modelId: "mock-fast",
      aspectRatio: "original",
      variationCount: 2,
    });
    expect(branch.parentGenerationId).toBe(generation.id);
    await waitFor(() => useListingsStore.getState().current?.generations[branch.id]?.status === "completed");
    current = useListingsStore.getState().current!;
    expect(Object.values(current.images).filter((i) => i.kind === "generation")).toHaveLength(6);

    // Persisted: reopen from storage.
    await listings.flush();
    listings.close();
    const reopened = await listings.open(current.listing.id);
    expect(reopened).not.toBeNull();
    expect(Object.keys(reopened!.generations)).toHaveLength(2);
    expect(Object.values(reopened!.jobs).every((j) => j.status === "completed")).toBe(true);
    const summaries = await storage.listListings();
    expect(summaries[0]?.imageCount).toBe(6);
  });

  it("keeps the other variations when one fails and lets the user retry it", async () => {
    const { mock } = await import("./services").then((m) => m.getServices());
    let calls = 0;
    const original = mock.generate.bind(mock);
    mock.generate = async (req, opts) => {
      calls++;
      if (calls === 2) {
        const { AppError } = await import("@/domain/models");
        throw new AppError("CONTENT_REJECTED", "nope");
      }
      return original(req, opts);
    };
    const current = useListingsStore.getState().current!;
    const gen = await useGenerationStore.getState().start({
      sourceImageId: current.listing.originalImageId!,
      prompt: "partial",
      providerId: "mock",
      modelId: "mock-fast",
      aspectRatio: "original",
      variationCount: 3,
    });
    await waitFor(() => {
      const g = useListingsStore.getState().current?.generations[gen.id];
      return g?.status === "partial";
    });
    const doc = useListingsStore.getState().current!;
    const failed = gen.jobIds.map((id) => doc.jobs[id]!).find((j) => j.status === "failed")!;
    expect(failed.error?.code).toBe("CONTENT_REJECTED");
    expect(gen.jobIds.map((id) => doc.jobs[id]!).filter((j) => j.status === "completed")).toHaveLength(2);

    const seedBefore = failed.seed;
    useGenerationStore.getState().retryJob(failed.id);
    await waitFor(() => useListingsStore.getState().current?.generations[gen.id]?.status === "completed");
    // A manual retry draws a fresh seed: a diffusion model would otherwise reproduce the same (rejected) output.
    const retried = useListingsStore.getState().current!.jobs[failed.id]!;
    expect(retried.status).toBe("completed");
    expect(retried.seed).toBeDefined();
    expect(retried.seed).not.toBe(seedBefore);
    mock.generate = original;
  });

  it("deletes images and generations without leaving orphaned files", async () => {
    const listings = useListingsStore.getState();
    const doc = useListingsStore.getState().current!;
    const genId = Object.keys(doc.generations)[0]!;
    const imageIds = doc.generations[genId]!.jobIds.map((id) => doc.jobs[id]!.resultImageId!);
    await listings.deleteGeneration(genId);
    const after = useListingsStore.getState().current!;
    expect(after.generations[genId]).toBeUndefined();
    for (const id of imageIds) {
      expect(after.images[id]).toBeUndefined();
      expect(await storage.readImage(after.listing.id, "generation", id)).toBeNull();
      expect(await storage.readImage(after.listing.id, "thumbnail", id)).toBeNull();
    }
    expect(await storage.cleanupOrphans(after.listing.id)).toBe(0);
  });
});

describe("listing packs", () => {
  it("generates one job per shot with distinct prompts and labels, and stores the copy on the listing", async () => {
    const listings = useListingsStore.getState();
    const doc = listings.current!;
    const { buildShots } = await import("@/domain/services/catalog");
    const category = { categoryId: "women" as const, subcategoryId: "shoes" };
    const shots = buildShots(category);
    const gen = await useGenerationStore.getState().start({
      sourceImageId: doc.listing.originalImageId!,
      prompt: "",
      providerId: "mock",
      modelId: "mock-fast",
      aspectRatio: "3:4",
      variationCount: 1,
      category,
      shots,
      recipeId: "rcp_listing_women_shoes",
    });
    expect(gen.jobIds).toHaveLength(5);
    expect(gen.category).toEqual(category);
    await waitFor(() => useListingsStore.getState().current?.generations[gen.id]?.status === "completed");
    const after = useListingsStore.getState().current!;
    const jobs = gen.jobIds.map((id) => after.jobs[id]!);
    expect(jobs.map((j) => j.shotId)).toEqual(["retouch", "studio", "worn", "selfie", "profile"]);
    expect(new Set(jobs.map((j) => j.prompt)).size).toBe(5);
    expect(jobs[2]!.shotLabel?.fr).toBe("Portées");
    expect(new Set(jobs.map((j) => j.seed)).size).toBeGreaterThan(1);

    const { useListingSetupStore } = await import("./stores/listing-setup-store");
    useListingSetupStore.getState().setCategory(category);
    expect(useListingsStore.getState().current?.listing.category).toEqual(category);
    // No vision model for the mock provider: a clear error, no crash.
    const { useSettingsStore } = await import("./stores/settings-store");
    expect(useSettingsStore.getState().settings.copyProviderId).toBe("gemini");
    useSettingsStore.setState({ settings: { ...useSettingsStore.getState().settings, copyProviderId: "mock" } });
    expect(await useListingSetupStore.getState().generateCopy()).toBeNull();
    expect(useListingSetupStore.getState().copyError?.code).toBe("PROVIDER_UNAVAILABLE");
  });
  it("retries a content-filter rejection with a softened prompt (no logo clause), other errors keep the prompt", async () => {
    const listings = useListingsStore.getState();
    const file = new File([Uint8Array.from(PNG_HEADER)], "shoes.png", { type: "image/png" });
    const doc = await listings.createFromFile(file, "shoes.png");
    const [shot] = buildShots({ categoryId: "men", subcategoryId: "shoes" });
    const base = {
      id: "job_x",
      listingId: doc.listing.id,
      generationId: "gen_x",
      sourceImageId: doc.listing.originalImageId!,
      index: 0,
      prompt: shot!.prompt,
      provider: "mock",
      model: "mock-fast",
      aspectRatio: "original" as const,
      status: "generating" as const,
      createdAt: "",
      seed: 7,
    };
    const first = await buildRequestForJob({ ...base, attempt: 1 }, new AbortController().signal);
    expect(first.prompt).toContain("logos and any visible text identical");
    const rejected = { code: "CONTENT_REJECTED" as const, message: "flagged", retryable: true };
    const second = await buildRequestForJob({ ...base, attempt: 2, error: rejected }, new AbortController().signal);
    expect(second.prompt).not.toContain("logos");
    expect(second.prompt).toContain("do not add or remove elements");
    const network = { code: "NETWORK_ERROR" as const, message: "net", retryable: true };
    const third = await buildRequestForJob({ ...base, attempt: 2, error: network }, new AbortController().signal);
    expect(third.prompt).toBe(shot!.prompt);
  });
});
