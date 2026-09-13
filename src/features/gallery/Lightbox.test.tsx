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
import { useUiStore } from "@/app/stores/ui-store";
import { IndexedDbStorage } from "@/infrastructure/storage/IndexedDbStorage";
import { Lightbox } from "./Lightbox";

const PNG = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])], { type: "image/png" });

describe("Lightbox", () => {
  const storage = new IndexedDbStorage("lightbox-test");
  beforeAll(async () => {
    __setServices(null);
    createServices({ buildRequest: buildRequestForJob, persistResult: persistJobResult, onJobUpdate: applyJobUpdate, storage });
    await storage.init();
  });
  beforeEach(async () => {
    await useListingsStore.getState().createFromFile(PNG, "item.png");
  });
  afterEach(() => {
    cleanup();
    act(() => useUiStore.getState().closeLightbox());
  });

  it("gives the viewer the whole row so the image is centred (it shrank to the image's width, flush left)", () => {
    const originalId = useListingsStore.getState().current!.listing.originalImageId!;
    act(() => useUiStore.getState().openLightbox(originalId));
    render(<Lightbox />);
    const dialog = screen.getByRole("dialog");
    const viewer = dialog.querySelector("figure")!;
    expect(viewer.className).toContain("flex-1");
    expect(viewer.className).toContain("justify-center");
    expect(viewer.className).toContain("items-center");
  });
});
