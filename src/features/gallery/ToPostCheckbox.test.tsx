import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

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
import { ToPostCheckbox } from "./ToPostCheckbox";

const PNG = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])], { type: "image/png" });

describe("ToPostCheckbox", () => {
  const storage = new IndexedDbStorage("to-post-checkbox-test");
  beforeAll(async () => {
    __setServices(null);
    createServices({ buildRequest: buildRequestForJob, persistResult: persistJobResult, onJobUpdate: applyJobUpdate, storage });
    await storage.init();
  });
  beforeEach(async () => {
    await useListingsStore.getState().createFromFile(PNG, "item.png");
  });
  afterEach(() => cleanup());

  it("is a checkbox that marks the photo “To post” and back, without bubbling to the tile", () => {
    const originalId = useListingsStore.getState().current!.listing.originalImageId!;
    const onTile = vi.fn();
    const { rerender } = render(
      <div className="group" onClick={onTile}>
        <ToPostCheckbox assetId={originalId} checked={false} />
      </div>,
    );
    const box = screen.getByRole("checkbox", { name: "To post" });
    expect(box).toHaveAttribute("aria-checked", "false");
    // Visible without hover on touch screens, hover-revealed with a mouse.
    expect(box.className).toContain("pointer-coarse:opacity-100");
    expect(box.className).toContain("group-hover:opacity-100");

    fireEvent.click(box);
    expect(useListingsStore.getState().current!.toPost).toContain(originalId);
    expect(onTile).not.toHaveBeenCalled();

    rerender(
      <div className="group" onClick={onTile}>
        <ToPostCheckbox assetId={originalId} checked />
      </div>,
    );
    const checked = screen.getByRole("checkbox", { name: "Don't post" });
    expect(checked).toHaveAttribute("aria-checked", "true");
    // Once checked it stays visible everywhere.
    expect(checked.className).toContain("opacity-100");
    expect(checked.className).not.toContain("opacity-0");
    fireEvent.click(checked);
    expect(useListingsStore.getState().current!.toPost).not.toContain(originalId);
  });
});
