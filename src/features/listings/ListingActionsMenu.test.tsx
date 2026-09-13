/** The listing actions menu: rename / duplicate / delete (app only, never Vinted), with confirmation. */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/infrastructure/image/image-processing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/infrastructure/image/image-processing")>();
  const fakeBitmap = { width: 10, height: 10, close: () => undefined } as unknown as ImageBitmap;
  return {
    ...actual,
    decodeImage: async () => ({ bitmap: fakeBitmap, width: 10, height: 10 }),
    createThumbnail: async () => new Blob([Uint8Array.from([1, 2, 3])], { type: "image/webp" }),
  };
});

import { currentRoute, navigate } from "@/app/router";
import { __setServices, createServices } from "@/app/services";
import { applyJobUpdate, buildRequestForJob, persistJobResult } from "@/app/stores/generation-store";
import { useListingsStore } from "@/app/stores/listings-store";
import { IndexedDbStorage } from "@/infrastructure/storage/IndexedDbStorage";
import { ListingActionsMenu } from "./ListingActionsMenu";

const PNG = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])], { type: "image/png" });

describe("ListingActionsMenu", () => {
  const storage = new IndexedDbStorage("listing-actions-menu-test");
  beforeAll(async () => {
    __setServices(null);
    createServices({ buildRequest: buildRequestForJob, persistResult: persistJobResult, onJobUpdate: applyJobUpdate, storage });
    await storage.init();
  });
  beforeEach(() => navigate({ name: "home" }));
  afterEach(cleanup);

  it("deletes only after confirmation, and names the listing in the question", async () => {
    const user = userEvent.setup();
    const doc = await useListingsStore.getState().createFromFile(PNG, "chemise.png");
    render(<ListingActionsMenu listing={{ id: doc.listing.id, name: "Chemise" }} />);
    await user.click(screen.getByRole("button", { name: "Listing actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("“Chemise” and all of its images will be removed from this device");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await storage.getListing(doc.listing.id)).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Listing actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    await user.click(screen.getAllByRole("button", { name: "Delete" }).at(-1)!);
    await vi.waitFor(async () => expect(await storage.getListing(doc.listing.id)).toBeNull());
    expect(useListingsStore.getState().summaries.find((s) => s.id === doc.listing.id)).toBeUndefined();
  });

  it("leaves the workspace of the listing being deleted", async () => {
    const user = userEvent.setup();
    const doc = await useListingsStore.getState().createFromFile(PNG, "open.png");
    navigate({ name: "listing", id: doc.listing.id });
    render(<ListingActionsMenu listing={{ id: doc.listing.id, name: "Open" }} />);
    await user.click(screen.getByRole("button", { name: "Listing actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));
    await user.click(screen.getAllByRole("button", { name: "Delete" }).at(-1)!);
    await vi.waitFor(() => expect(currentRoute()).toEqual({ name: "home" }));
  });

  it("renames through the dialog", async () => {
    const user = userEvent.setup();
    const doc = await useListingsStore.getState().createFromFile(PNG, "r.png");
    render(<ListingActionsMenu listing={{ id: doc.listing.id, name: "r" }} />);
    await user.click(screen.getByRole("button", { name: "Listing actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByRole("textbox", { name: "Name" });
    await user.clear(input);
    await user.type(input, "Robe rouge{Enter}");
    await vi.waitFor(() => expect(useListingsStore.getState().summaries.find((s) => s.id === doc.listing.id)?.name).toBe("Robe rouge"));
  });
});
