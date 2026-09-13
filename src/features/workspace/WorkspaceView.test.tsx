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
import { useUiStore } from "@/app/stores/ui-store";
import { IndexedDbStorage } from "@/infrastructure/storage/IndexedDbStorage";
import { renderWithQuery, resetQueryClient } from "@/test/render";
import { WorkspaceView } from "./WorkspaceView";

const PNG = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])], { type: "image/png" });

describe("WorkspaceView", () => {
  const storage = new IndexedDbStorage("workspace-view-test");
  beforeAll(async () => {
    __setServices(null);
    createServices({ buildRequest: buildRequestForJob, persistResult: persistJobResult, onJobUpdate: applyJobUpdate, storage });
    await storage.init();
  });
  beforeEach(() => resetQueryClient());
  afterEach(() => cleanup());

  it("closes the fullscreen viewer when the listing is left, so it is not open again on return", async () => {
    const doc = await useListingsStore.getState().createFromFile(PNG, "item.png");
    const id = doc.listing.id;
    const { unmount } = renderWithQuery(<WorkspaceView listingId={id} />);
    await screen.findByText(doc.listing.name);
    act(() => useUiStore.getState().openLightbox(doc.listing.originalImageId!));
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // The user opens the sidebar and goes elsewhere: the workspace unmounts.
    unmount();
    expect(useUiStore.getState().lightboxAssetId).toBeNull();

    renderWithQuery(<WorkspaceView listingId={id} />);
    await screen.findByText(doc.listing.name);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
