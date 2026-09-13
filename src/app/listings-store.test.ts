/** Listings store: switching listings never leaves the previous one's jobs running against a closed document. */
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/image/image-processing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/infrastructure/image/image-processing")>();
  const fakeBitmap = { width: 10, height: 10, close: () => undefined } as unknown as ImageBitmap;
  return {
    ...actual,
    decodeImage: async () => ({ bitmap: fakeBitmap, width: 10, height: 10 }),
    createThumbnail: async () => new Blob([Uint8Array.from([1, 2, 3])], { type: "image/webp" }),
  };
});

import { IndexedDbStorage } from "@/infrastructure/storage/IndexedDbStorage";
import { ensureModels } from "./query/models";
import { __setServices, createServices, getServices } from "./services";
import { useComposerStore } from "./stores/composer-store";
import { applyJobUpdate, buildRequestForJob, persistJobResult, useGenerationStore } from "./stores/generation-store";
import { useListingsStore } from "./stores/listings-store";

const PNG = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])], { type: "image/png" });

describe("useListingsStore.open", () => {
  const storage = new IndexedDbStorage("listings-store-test");
  beforeAll(async () => {
    __setServices(null);
    createServices({ buildRequest: buildRequestForJob, persistResult: persistJobResult, onJobUpdate: applyJobUpdate, storage });
    await storage.init();
  });

  it("cancels the previous listing's running jobs and records them as cancelled before switching", async () => {
    const services = getServices();
    services.mock.setOptions({ latencyMs: 2000, scenario: "success" });
    services.queue.configure({ concurrency: 2, maxAttempts: 1, timeoutMs: 10_000 });
    useComposerStore.getState().setProvider("mock");
    await ensureModels("mock");
    const other = await useListingsStore.getState().createFromFile(PNG, "other.png");
    const busy = await useListingsStore.getState().createFromFile(PNG, "busy.png");
    const gen = await useGenerationStore.getState().start({
      sourceImageId: busy.listing.originalImageId!,
      prompt: "studio",
      providerId: "mock",
      modelId: "mock-fast",
      aspectRatio: "original",
      variationCount: 2,
    });
    expect(services.queue.activeCount).toBe(2);

    await useListingsStore.getState().open(other.listing.id);

    expect(services.queue.activeCount).toBe(0);
    expect(useListingsStore.getState().current?.listing.id).toBe(other.listing.id);
    const saved = await storage.getListing(busy.listing.id);
    expect(gen.jobIds.map((id) => saved?.jobs[id]?.status)).toEqual(["cancelled", "cancelled"]);
    services.mock.setOptions({ latencyMs: 5, scenario: "success" });
  });
});
