/** Importing a photo can take a while on a phone (decode + thumbnail + save): the app shows it is busy. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { useListingsStore } from "@/app/stores/listings-store";
import { useUiStore } from "@/app/stores/ui-store";
import { importImageFile } from "./useImageImport";

describe("importImageFile", () => {
  afterEach(() => vi.restoreAllMocks());

  it("raises the app-wide import indicator while the file becomes a listing, and lowers it afterwards", async () => {
    let finish: (doc: never) => void = () => undefined;
    vi.spyOn(useListingsStore.getState(), "createFromFile").mockImplementation(() => new Promise((resolve) => (finish = resolve as (doc: never) => void)));
    expect(useUiStore.getState().importing).toBe(false);
    const done = importImageFile(new Blob(["x"], { type: "image/png" }), "x.png");
    await vi.waitFor(() => expect(useUiStore.getState().importing).toBe(true));
    finish({ listing: { id: "lst_00000000000000000000000000000001" } } as never);
    expect(await done).toBe(true);
    expect(useUiStore.getState().importing).toBe(false);
  });

  it("lowers the indicator when the import fails", async () => {
    vi.spyOn(useListingsStore.getState(), "createFromFile").mockRejectedValue(new Error("boom"));
    expect(await importImageFile(new Blob(["x"], { type: "image/png" }), "x.png")).toBe(false);
    expect(useUiStore.getState().importing).toBe(false);
  });
});
