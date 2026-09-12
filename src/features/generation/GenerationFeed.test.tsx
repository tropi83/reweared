import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

vi.mock("@/infrastructure/image/image-processing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/infrastructure/image/image-processing")>();
  const fakeBitmap = { width: 640, height: 480, close: () => undefined } as unknown as ImageBitmap;
  return {
    ...actual,
    decodeImage: async () => ({ bitmap: fakeBitmap, width: 640, height: 480 }),
    createThumbnail: async () => new Blob([Uint8Array.from([1, 2, 3])], { type: "image/webp" }),
  };
});

import { __setServices, createServices } from "@/app/services";
import { applyJobUpdate, buildRequestForJob, persistJobResult } from "@/app/stores/generation-store";
import { useListingsStore } from "@/app/stores/listings-store";
import type { Generation } from "@/domain/models";
import { IndexedDbStorage } from "@/infrastructure/storage/IndexedDbStorage";
import { GenerationFeed } from "./GenerationFeed";

const PNG = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])], { type: "image/png" });

function addGeneration(id: string): void {
  useListingsStore.getState().commit((d) => {
    const gen: Generation = {
      id,
      listingId: d.listing.id,
      sourceImageId: d.listing.originalImageId!,
      prompt: `prompt ${id}`,
      settings: { providerId: "mock", modelId: "mock-fast", aspectRatio: "original", variationCount: 1 },
      status: "active",
      jobIds: [],
      createdAt: new Date().toISOString(),
    };
    d.generations[id] = gen;
  });
}

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
