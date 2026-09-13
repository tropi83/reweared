import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/infrastructure/image/image-processing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/infrastructure/image/image-processing")>();
  const fakeBitmap = { width: 640, height: 480, close: () => undefined } as unknown as ImageBitmap;
  return {
    ...actual,
    decodeImage: async () => ({ bitmap: fakeBitmap, width: 640, height: 480 }),
    createThumbnail: async () => new Blob([Uint8Array.from([1, 2, 3])], { type: "image/webp" }),
  };
});

import { __setServices, createServices, getServices } from "@/app/services";
import { applyJobUpdate, buildRequestForJob, persistJobResult } from "@/app/stores/generation-store";
import { useListingsStore } from "@/app/stores/listings-store";
import type { Generation } from "@/domain/models";
import { IndexedDbStorage } from "@/infrastructure/storage/IndexedDbStorage";
import { GenerationFeed } from "./GenerationFeed";

const PNG = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])], { type: "image/png" });

function addGeneration(id: string, category?: Generation["category"]): void {
  useListingsStore.getState().commit((d) => {
    const gen: Generation = {
      id,
      listingId: d.listing.id,
      sourceImageId: d.listing.originalImageId!,
      prompt: `prompt ${id}`,
      ...(category ? { category } : {}),
      settings: { providerId: "mock", modelId: "mock-fast", aspectRatio: "original", variationCount: 1 },
      status: "active",
      jobIds: [],
      createdAt: new Date().toISOString(),
    };
    d.generations[id] = gen;
  });
}

describe("GenerationFeed › regenerate one photo", () => {
  const storage = new IndexedDbStorage("feed-regenerate-test");
  beforeAll(async () => {
    __setServices(null);
    createServices({ buildRequest: buildRequestForJob, persistResult: persistJobResult, onJobUpdate: applyJobUpdate, storage });
    await storage.init();
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => cleanup());

  it("offers 'Generate this photo again' on a finished tile and appends a queued job with the same shot", async () => {
    const doc = await useListingsStore.getState().createFromFile(PNG, "item.png");
    const originalId = doc.listing.originalImageId!;
    act(() => {
      addGeneration("gen_done");
      useListingsStore.getState().commit((d) => {
        // The original stands in for the result image: the tile only needs an asset to show.
        d.jobs.job_worn = {
          id: "job_worn",
          listingId: d.listing.id,
          generationId: "gen_done",
          sourceImageId: originalId,
          index: 1,
          prompt: "the shoes worn",
          shotId: "worn",
          shotLabel: { en: "Worn", fr: "Portées" },
          provider: "mock",
          model: "mock-fast",
          aspectRatio: "original",
          seed: 7,
          status: "completed",
          attempt: 1,
          resultImageId: originalId,
          createdAt: new Date().toISOString(),
        };
        d.generations.gen_done!.jobIds = ["job_worn"];
        d.generations.gen_done!.status = "completed";
      });
    });
    render(<GenerationFeed />);
    expect(screen.queryByRole("button", { name: "Generate more like this" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Generate this photo again" }));
    const current = useListingsStore.getState().current!;
    const ids = current.generations.gen_done!.jobIds;
    expect(ids).toHaveLength(2);
    const added = current.jobs[ids[1]!]!;
    expect(added).toMatchObject({ prompt: "the shoes worn", shotId: "worn", index: 2, sourceImageId: originalId });
    expect(added.seed).not.toBe(7);
    expect(added.resultImageId).toBeUndefined();
    getServices().queue.cancelAll();
  });
});

describe("GenerationFeed › scroll to a new run", () => {
  const storage = new IndexedDbStorage("feed-test");
  const scrollIntoView = vi.fn();
  beforeAll(async () => {
    __setServices(null);
    createServices({ buildRequest: buildRequestForJob, persistResult: persistJobResult, onJobUpdate: applyJobUpdate, storage });
    await storage.init();
    Element.prototype.scrollIntoView = scrollIntoView;
  });
  beforeEach(async () => {
    scrollIntoView.mockClear();
    await useListingsStore.getState().createFromFile(PNG, "item.png");
  });
  afterEach(() => cleanup());

  it("shows the subcategory icon on a pack card", () => {
    act(() => addGeneration("gen_pack", { categoryId: "women", subcategoryId: "bags" }));
    render(<GenerationFeed />);
    expect(screen.getByRole("article", { name: "prompt gen_pack" }).querySelector("svg.lucide-shopping-bag")).not.toBeNull();
  });

  it("does not scroll for the generations already there when the listing opens", () => {
    act(() => addGeneration("gen_old"));
    render(<GenerationFeed />);
    expect(screen.getByRole("article", { name: "prompt gen_old" })).toBeInTheDocument();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("smoothly scrolls the newly started generation into view, once", () => {
    act(() => addGeneration("gen_old"));
    render(<GenerationFeed />);
    act(() => addGeneration("gen_new"));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(screen.getByRole("article", { name: "prompt gen_new" }));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    // A re-render with the same generations does not scroll again.
    act(() => useListingsStore.getState().commit((d) => void (d.listing.brand = "x")));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});
