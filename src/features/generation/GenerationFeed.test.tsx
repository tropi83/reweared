import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

import { useListingsStore } from "@/app/stores/listings-store";
import type { Generation } from "@aiv/domain/models";
import { useFakeServices, type FakeServer } from "@/test/fake-api";
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
      settings: { providerId: "mock", modelId: "mock-image", aspectRatio: "original", variationCount: 1 },
      status: "active",
      jobIds: [],
      createdAt: new Date().toISOString(),
    };
    d.generations[id] = gen;
  });
}

describe("GenerationFeed › regenerate one photo", () => {
  let server: FakeServer;
  beforeEach(async () => {
    ({ server } = await useFakeServices());
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => cleanup());

  it("offers 'Generate this photo again' on a finished tile and asks the server for that shot again", async () => {
    const doc = await useListingsStore.getState().createFromFile(PNG, "item.png");
    const originalId = doc.listing.originalImageId!;
    act(() => {
      useListingsStore.getState().commit((d) => void (d.listing.category = { categoryId: "women", subcategoryId: "clothing" }), { immediate: true });
      addGeneration("gen_done");
      useListingsStore.getState().commit((d) => {
        // The original stands in for the result image: the tile only needs an asset to show.
        d.jobs.job_worn = {
          id: "job_worn",
          listingId: d.listing.id,
          generationId: "gen_done",
          sourceImageId: originalId,
          index: 1,
          prompt: "the shirt worn",
          shotId: "worn",
          shotLabel: { en: "Worn", fr: "Porté" },
          provider: "mock",
          model: "mock-image",
          aspectRatio: "original",
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
    await vi.waitFor(() => expect(server.calls.some((c) => c.path.endsWith("/generations"))).toBe(true));
    expect(server.calls.find((c) => c.path.endsWith("/generations"))?.body).toEqual({ sourceImageId: originalId, shotIds: ["worn"], aspectRatio: "original" });
  });
});

describe("GenerationFeed › scroll to a new run", () => {
  const scrollIntoView = vi.fn();
  beforeEach(async () => {
    await useFakeServices();
    Element.prototype.scrollIntoView = scrollIntoView;
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
