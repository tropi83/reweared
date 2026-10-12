/**
 * "Create the listing" through the stores against the fake API: the photo pack and the text start together on the
 * server, the text waits for its job's event, and each part reports its own outcome.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/infrastructure/image/image-processing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/infrastructure/image/image-processing")>();
  const fakeBitmap = { width: 640, height: 480, close: () => undefined } as unknown as ImageBitmap;
  return { ...actual, decodeImage: async () => ({ bitmap: fakeBitmap, width: 640, height: 480 }) };
});

import { json, useFakeServices, type FakeServer } from "@/test/fake-api";
import { resetQueryClient } from "@/test/render";
import { listingReadiness } from "./listing-readiness";
import { BRAND_MAX_LENGTH, settleRemoteCopy, useListingSetupStore } from "./stores/listing-setup-store";
import { useListingsStore } from "./stores/listings-store";

const PNG = new Blob([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])], { type: "image/png" });
const COPY_JOB = "job_00000000000000c0";

let server: FakeServer;

/** The copy run gets a known job id, so the test can end it with an event. */
function knownCopyJob() {
  server.override = (method, path) =>
    method === "POST" && path.endsWith("/copy") ? json(202, { generationId: "gen_00000000000000c0", kind: "copy", jobIds: [COPY_JOB], credits: 1 }) : undefined;
}

const finishCopy = (status: "completed" | "failed", title?: string) => {
  const doc = [...server.docs.values()][0]!;
  if (title) doc.listing.copy = { title, description: "", keywords: [], language: "en", generatedAt: "2026-10-12T08:00:00.000Z", provider: "mock", model: "m" };
  return settleRemoteCopy({
    type: "job",
    jobId: COPY_JOB,
    generationId: "gen_00000000000000c0",
    listingId: doc.listing.id,
    status,
    attempt: 1,
    ...(status === "failed" ? { error: { code: "PROVIDER_UNAVAILABLE", message: "Down." } } : {}),
  });
};

async function openNewListing() {
  const doc = await useListingsStore.getState().createFromFile(PNG, "shoes.png");
  useListingSetupStore.getState().setCategory({ categoryId: "men", subcategoryId: "shoes" });
  useListingSetupStore.getState().setBrand("Adidas");
  return doc;
}

beforeEach(async () => {
  resetQueryClient();
  ({ server } = await useFakeServices());
  knownCopyJob();
  useListingsStore.setState({ current: null, summaries: [] });
  useListingSetupStore.setState({ creating: false, copyBusy: false, copyError: null, lastRun: null, lastRunListingId: null });
});

describe("generateListing", () => {
  it("saves the seller's choices first, then starts the pack and the text together", async () => {
    const doc = await openNewListing();
    const run = useListingSetupStore.getState().generateListing();
    await vi.waitFor(() => expect(server.calls.some((c) => c.path.endsWith("/copy"))).toBe(true));

    const order = server.calls.map((c) => `${c.method} ${c.path.replace(doc.listing.id, ":id")}`);
    const patch = order.indexOf("PATCH /api/v1/listings/:id");
    expect(patch).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("POST /api/v1/listings/:id/generations")).toBeGreaterThan(patch);
    expect(server.calls.find((c) => c.method === "PATCH")?.body).toMatchObject({ brand: "Adidas", category: { categoryId: "men", subcategoryId: "shoes" } });

    await finishCopy("completed", "Adidas running shoes");
    expect(await run).toEqual({ photos: "done", text: "done" });
    expect(useListingsStore.getState().current?.listing.copy?.title).toBe("Adidas running shoes");
    expect(Object.keys(useListingsStore.getState().current?.jobs ?? {}).length).toBeGreaterThan(0);
  });

  it("a text failure does not cancel the photos", async () => {
    await openNewListing();
    const run = useListingSetupStore.getState().generateListing();
    await vi.waitFor(() => expect(server.calls.some((c) => c.path.endsWith("/copy"))).toBe(true));
    await finishCopy("failed");
    const report = await run;
    expect(report?.photos).toBe("done");
    expect(report?.text).toMatchObject({ error: { code: "PROVIDER_UNAVAILABLE" } });
    expect(useListingSetupStore.getState().copyError?.code).toBe("PROVIDER_UNAVAILABLE");
  });

  it("reports missing credits for the photos in the platform's words", async () => {
    await openNewListing();
    server.balance = 0;
    const run = useListingSetupStore.getState().generateListing();
    await vi.waitFor(() => expect(server.calls.some((c) => c.path.endsWith("/copy"))).toBe(true));
    await finishCopy("completed", "Shoes");
    expect((await run)?.photos).toMatchObject({ error: { code: "QUOTA_EXCEEDED", detail: "INSUFFICIENT_CREDITS" } });
  });

  it("refuses without a complete selection and caps the brand", async () => {
    await useListingsStore.getState().createFromFile(PNG, "shoes.png");
    expect(await useListingSetupStore.getState().generateListing()).toBeNull();
    expect(server.calls.some((c) => c.path.endsWith("/generations"))).toBe(false);
    useListingSetupStore.getState().setBrand("x".repeat(BRAND_MAX_LENGTH + 20));
    expect(useListingsStore.getState().current?.listing.brand).toHaveLength(BRAND_MAX_LENGTH);
  });
});

describe("listingReadiness", () => {
  it("names the first blocker", () => {
    expect(listingReadiness({ hasImage: false, hasSelection: true })).toEqual({ canCreate: false, blocker: "composer.needImage" });
    expect(listingReadiness({ hasImage: true, hasSelection: false }).blocker).toBe("listing.needCategory");
    expect(listingReadiness({ hasImage: true, hasSelection: true })).toEqual({ canCreate: true, blocker: null });
  });

  it("blocks a run the account cannot pay for", () => {
    const ready = { hasImage: true, hasSelection: true };
    expect(listingReadiness({ ...ready, credits: { balance: 5, cost: 6 } })).toEqual({ canCreate: false, blocker: "listing.needCredits" });
    expect(listingReadiness({ ...ready, credits: { balance: 6, cost: 6 } }).canCreate).toBe(true);
    // A missing image or category is said first.
    expect(listingReadiness({ ...ready, hasSelection: false, credits: { balance: 0, cost: 6 } }).blocker).toBe("listing.needCategory");
  });
});
