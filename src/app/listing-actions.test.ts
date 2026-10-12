/** Deleting a listing from the app (never from Vinted): everything bound to it stops first, then the server deletes it. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/image/image-processing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/infrastructure/image/image-processing")>();
  const fakeBitmap = { width: 10, height: 10, close: () => undefined } as unknown as ImageBitmap;
  return {
    ...actual,
    decodeImage: async () => ({ bitmap: fakeBitmap, width: 10, height: 10 }),
    createThumbnail: async () => new Blob([Uint8Array.from([1, 2, 3])], { type: "image/webp" }),
  };
});

import { json, useFakeServices, type FakeServer } from "@/test/fake-api";
import { deleteListing } from "./listing-actions";
import { currentRoute, navigate } from "./router";
import { getServices } from "./services";
import { useGenerationStore } from "./stores/generation-store";
import { useListingsStore } from "./stores/listings-store";
import { usePublishStore } from "./stores/publish-store";
import { useToastStore } from "./stores/toast-store";

const PNG = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])], { type: "image/png" });

let server: FakeServer;

describe("deleteListing", () => {
  beforeEach(async () => {
    ({ server } = await useFakeServices());
    useListingsStore.setState({ current: null, summaries: [] });
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

    expect(server.docs.has(id)).toBe(false);
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

    expect(server.docs.has(other.listing.id)).toBe(false);
    expect(useListingsStore.getState().current?.listing.id).toBe(current.listing.id);
    expect(currentRoute()).toEqual({ name: "listing", id: current.listing.id });
    expect(usePublishStore.getState().session.stage).toBe("browsing");
    expect(close).not.toHaveBeenCalled();
  });

  it("reports a server failure instead of pretending", async () => {
    const doc = await useListingsStore.getState().createFromFile(PNG, "x.png");
    server.override = (method) => (method === "DELETE" ? json(500, { code: "UNKNOWN_ERROR", message: "Down." }) : undefined);
    await deleteListing(doc.listing.id);
    expect(useToastStore.getState().toasts.at(-1)?.kind).toBe("error");
    expect(server.docs.has(doc.listing.id)).toBe(true);
  });

  it("stops the photos being generated for the open listing before deleting it", async () => {
    const doc = await useListingsStore.getState().createFromFile(PNG, "busy.png");
    navigate({ name: "listing", id: doc.listing.id });
    useListingsStore.getState().commit((d) => void (d.listing.category = { categoryId: "women", subcategoryId: "clothing" }), { immediate: true });
    const gen = await useGenerationStore
      .getState()
      .start({ sourceImageId: doc.listing.originalImageId!, shotIds: ["retouch", "studio"], aspectRatio: "original" });

    await deleteListing(doc.listing.id);

    await vi.waitFor(() => {
      for (const jobId of gen.jobIds) expect(server.calls.some((c) => c.method === "POST" && c.path === `/api/v1/jobs/${jobId}/cancel`)).toBe(true);
    });
    expect(server.calls.some((c) => c.method === "DELETE" && c.path === `/api/v1/listings/${doc.listing.id}`)).toBe(true);
    expect(useListingsStore.getState().current).toBeNull();
  });
});
