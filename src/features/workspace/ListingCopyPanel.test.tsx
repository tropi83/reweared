import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen } from "@testing-library/react";

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
import { IndexedDbStorage } from "@/infrastructure/storage/IndexedDbStorage";
import { renderWithQuery, resetQueryClient } from "@/test/render";
import { ListingCopyPanel } from "./ListingCopyPanel";

const PNG = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])], { type: "image/png" });

describe("ListingCopyPanel", () => {
  const storage = new IndexedDbStorage("copy-panel-test");
  beforeAll(async () => {
    __setServices(null);
    createServices({ buildRequest: buildRequestForJob, persistResult: persistJobResult, onJobUpdate: applyJobUpdate, storage });
    await storage.init();
  });
  beforeEach(async () => {
    resetQueryClient();
    await useListingsStore.getState().createFromFile(PNG, "item.png");
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("labels the attribute badges and hashes only the keywords", () => {
    act(() => {
      useListingsStore.getState().commit((d) => {
        d.listing.copy = {
          title: "T",
          description: "D",
          condition: "very_good",
          brand: "Nike",
          color: "blue",
          keywords: ["running", "shoes"],
          language: "en",
          generatedAt: "",
          provider: "gemini",
          model: "m",
        };
      });
    });
    renderWithQuery(<ListingCopyPanel />);
    expect(screen.getByText("Condition: Very good condition")).toBeInTheDocument();
    expect(screen.getByText("Brand: Nike")).toBeInTheDocument();
    expect(screen.getByText("Colour: blue")).toBeInTheDocument();
    expect(screen.getByText("#running")).toBeInTheDocument();
    expect(screen.getByText("#shoes")).toBeInTheDocument();
    expect(screen.queryByText(/^#Nike$/)).not.toBeInTheDocument();
  });
});
