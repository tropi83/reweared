/** Deleting a listing from the app (never from Vinted): everything bound to it stops first, then the files go. */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
import { deleteListing } from "./listing-actions";
import { currentRoute, navigate } from "./router";
import { __setServices, createServices, getServices } from "./services";
import { applyJobUpdate, buildRequestForJob, persistJobResult } from "./stores/generation-store";
import { useListingsStore } from "./stores/listings-store";
import { usePublishStore } from "./stores/publish-store";
import { ensureModels } from "./query/models";
import { useComposerStore } from "./stores/composer-store";
import { useGenerationStore } from "./stores/generation-store";
import { useToastStore } from "./stores/toast-store";

const PNG = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])], { type: "image/png" });

describe("deleteListing", () => {
  const storage = new IndexedDbStorage("listing-actions-test");
  beforeAll(async () => {
    __setServices(null);
    createServices({ buildRequest: buildRequestForJob, persistResult: persistJobResult, onJobUpdate: applyJobUpdate, storage });
    await storage.init();
  });
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    usePublishStore.setState({ session: { stage: "closed", busy: false } });
  });
  afterEach(() => vi.restoreAllMocks());

  it("removes the open listing, leaves the workspace, closes its Vinted session and confirms with a toast", async () => {
    const doc = await useListingsStore.getState().createFromFile(PNG, "chemise.png");
    const id = doc.listing.id;
    navigate({ name: "listing", id });
    usePublishStore.setState({ session: { stage: "filled", busy: false, listingId: id } });
    const close = vi.spyOn(getServices().publish, "close").mockResolvedValue();

    await deleteListing(id);

    expect(await storage.getListing(id)).toBeNull();
    expect(useListingsStore.getState().current).toBeNull();
    expect(useListingsStore.getState().summaries.find((s) => s.id === id)).toBeUndefined();
    expect(currentRoute()).toEqual({ name: "home" });
    expect(usePublishStore.getState().session.stage).toBe("closed");
    expect(close).toHaveBeenCalledTimes(1);
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe("Listing deleted");
  });

  it("removes another listing without touching the open one or its Vinted session", async () => {
    const other = await useListingsStore.getState().createFromFile(PNG, "other.png");
    const current = await useListingsStore.getState().createFromFile(PNG, "current.png");
    navigate({ name: "listing", id: current.listing.id });
    usePublishStore.setState({ session: { stage: "browsing", busy: false, listingId: current.listing.id } });
    const close = vi.spyOn(getServices().publish, "close").mockResolvedValue();

    await deleteListing(other.listing.id);

    expect(await storage.getListing(other.listing.id)).toBeNull();
    expect(useListingsStore.getState().current?.listing.id).toBe(current.listing.id);
    expect(currentRoute()).toEqual({ name: "listing", id: current.listing.id });
    expect(usePublishStore.getState().session.stage).toBe("browsing");
    expect(close).not.toHaveBeenCalled();
  });

  it("reports a storage failure instead of pretending", async () => {
    const doc = await useListingsStore.getState().createFromFile(PNG, "x.png");
    vi.spyOn(getServices().storage, "deleteListing").mockRejectedValue(new Error("disk"));
    await deleteListing(doc.listing.id);
    expect(useToastStore.getState().toasts.at(-1)?.kind).toBe("error");
    expect(await storage.getListing(doc.listing.id)).not.toBeNull();
  });

  it("cancels the photos being generated for the listing before removing it (no quota burnt, no write into a deleted folder)", async () => {
    const doc = await useListingsStore.getState().createFromFile(PNG, "busy.png");
    const services = getServices();
    services.mock.setOptions({ latencyMs: 2000, scenario: "success" });
    services.queue.configure({ concurrency: 2, maxAttempts: 1, timeoutMs: 10_000 });
    useComposerStore.getState().setProvider("mock");
    await ensureModels("mock");
    const gen = await useGenerationStore.getState().start({
      sourceImageId: doc.listing.originalImageId!,
      prompt: "studio",
      providerId: "mock",
      modelId: "mock-fast",
      aspectRatio: "original",
      variationCount: 3,
    });
    expect(services.queue.activeCount).toBe(3);

    await deleteListing(doc.listing.id);

    expect(services.queue.activeCount).toBe(0);
    expect(useListingsStore.getState().current).toBeNull();
    expect(await storage.getListing(doc.listing.id)).toBeNull();
    // The cancelled jobs never persisted a result for the deleted listing.
    await new Promise((r) => setTimeout(r, 50));
    expect(await storage.readImage(doc.listing.id, "generation", gen.jobIds[0]!)).toBeNull();
    services.mock.setOptions({ latencyMs: 5, scenario: "success" });
  });
});
