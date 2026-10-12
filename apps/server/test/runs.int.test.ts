import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createId } from "@aiv/domain/lib/ids";
import { buildShots } from "@aiv/domain/services/catalog";
import { creditBalance, creditLedger, generation, generationJob, imageAsset } from "../src/db/schema";
import { NeuronBudget } from "../src/queue/budget";
import { cancelKey } from "../src/generations/runs";
import { signIn, startHarness, verifiedUser, type Harness } from "./app-harness";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());
beforeEach(() => h.reset());

const CATEGORY = { categoryId: "women", subcategoryId: "clothing" } as const;
const SHOTS = buildShots(CATEGORY).length;

async function account(email: string): Promise<{ headers: { authorization: string }; userId: string }> {
  await verifiedUser(h, email);
  const res = await signIn(h, email);
  return { headers: { authorization: `Bearer ${String(res.headers["set-auth-token"])}` }, userId: res.json().user.id as string };
}

/** A listing with a category and an original photo row (no bytes needed to enqueue). */
async function readyListing(a: { headers: Record<string, string>; userId: string }): Promise<{ listingId: string; imageId: string }> {
  const listingId = (await h.app.inject({ method: "POST", url: "/api/v1/listings", headers: a.headers, payload: {} })).json().listing.id as string;
  const imageId = createId("img");
  await h.database.db.insert(imageAsset).values({
    id: imageId,
    listingId,
    userId: a.userId,
    kind: "original",
    mimeType: "image/jpeg",
    width: 10,
    height: 10,
    byteSize: 1,
    objectKey: "k",
    thumbKey: "t",
    sha256: "0".repeat(64),
  });
  await h.app.inject({ method: "PATCH", url: `/api/v1/listings/${listingId}`, headers: a.headers, payload: { category: CATEGORY } });
  await h.database.db.execute(sql`update listing set original_image_id = ${imageId} where id = ${listingId}`);
  return { listingId, imageId };
}

const counts = async () => ({
  generations: (await h.database.db.select().from(generation)).length,
  jobs: (await h.database.db.select().from(generationJob)).length,
  ledger: (await h.database.db.select().from(creditLedger)).length,
});
const balance = async (userId: string) => (await h.database.db.select().from(creditBalance).where(eq(creditBalance.userId, userId)))[0]?.balance;

describe("starting a photo pack", () => {
  it("reserves one credit per shot, queues the jobs and dispatches the user's share", async () => {
    const alice = await account("alice@example.test");
    const { listingId } = await readyListing(alice);
    const res = await h.app.inject({
      method: "POST",
      url: `/api/v1/listings/${listingId}/generations`,
      headers: alice.headers,
      payload: { aspectRatio: "4:5" },
    });
    expect(res.statusCode).toBe(202);
    const run = res.json();
    expect(run).toMatchObject({ kind: "images", credits: SHOTS });
    expect(run.jobIds).toHaveLength(SHOTS);
    expect(await balance(alice.userId)).toBe(60 - SHOTS);

    const doc = (await h.app.inject({ method: "GET", url: `/api/v1/listings/${listingId}`, headers: alice.headers })).json();
    expect(doc.generations[run.generationId]).toMatchObject({ status: "active", jobIds: run.jobIds, settings: { providerId: "mock", aspectRatio: "4:5" } });
    const jobs = run.jobIds.map((id: string) => doc.jobs[id]);
    expect(jobs.every((j: { status: string }) => j.status === "queued")).toBe(true);
    expect(new Set(jobs.map((j: { seed: number }) => j.seed)).size).toBe(SHOTS);
    expect(jobs[0].prompt).toBe(buildShots(CATEGORY)[0]!.prompt);
    const dispatched = await h.database.db.select().from(generationJob).where(eq(generationJob.status, "dispatched"));
    expect(dispatched).toHaveLength(Math.min(4, SHOTS));
  });

  it("writes nothing when credits are short (402): generation, jobs and reservation commit together", async () => {
    const alice = await account("alice@example.test");
    const { listingId } = await readyListing(alice);
    // This month's grant is already spent down to 2 credits.
    await h.app.inject({ method: "GET", url: "/api/v1/credits", headers: alice.headers });
    await h.database.db.update(creditBalance).set({ balance: 2 }).where(eq(creditBalance.userId, alice.userId));
    const before = await counts();
    const res = await h.app.inject({ method: "POST", url: `/api/v1/listings/${listingId}/generations`, headers: alice.headers, payload: {} });
    expect(res.statusCode).toBe(402);
    expect(res.json().code).toBe("INSUFFICIENT_CREDITS");
    expect(await counts()).toEqual(before);
    expect(await balance(alice.userId)).toBe(2);
  });

  it("needs a category and a photo, and accepts only the listing's own photos", async () => {
    const alice = await account("alice@example.test");
    const listingId = (await h.app.inject({ method: "POST", url: "/api/v1/listings", headers: alice.headers, payload: {} })).json().listing.id as string;
    expect((await h.app.inject({ method: "POST", url: `/api/v1/listings/${listingId}/generations`, headers: alice.headers, payload: {} })).statusCode).toBe(
      400,
    );
    const other = await readyListing(alice);
    const res = await h.app.inject({
      method: "POST",
      url: `/api/v1/listings/${listingId}/generations`,
      headers: alice.headers,
      payload: { sourceImageId: other.imageId },
    });
    expect(res.statusCode).toBe(404);
    expect(await counts()).toMatchObject({ generations: 0, jobs: 0 });
  });

  it("refuses provider or model choices from the client", async () => {
    const alice = await account("alice@example.test");
    const { listingId } = await readyListing(alice);
    const res = await h.app.inject({
      method: "POST",
      url: `/api/v1/listings/${listingId}/generations`,
      headers: alice.headers,
      payload: { provider: "gemini" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("listing copy, cancel and retry", () => {
  it("starts a copy run of one credit", async () => {
    const alice = await account("alice@example.test");
    const { listingId } = await readyListing(alice);
    const res = await h.app.inject({ method: "POST", url: `/api/v1/listings/${listingId}/copy`, headers: alice.headers, payload: { language: "fr" } });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ kind: "copy", credits: 1 });
    // Copy runs are not photo-pack generations.
    const doc = (await h.app.inject({ method: "GET", url: `/api/v1/listings/${listingId}`, headers: alice.headers })).json();
    expect(doc.generations).toEqual({});
  });

  it("cancels a waiting job with one refund, tells a running job to stop, and refuses a finished one", async () => {
    const alice = await account("alice@example.test");
    const { listingId } = await readyListing(alice);
    const run = (await h.app.inject({ method: "POST", url: `/api/v1/listings/${listingId}/generations`, headers: alice.headers, payload: {} })).json();
    const [first, second, third] = run.jobIds as string[];
    const cancel = (id: string) => h.app.inject({ method: "POST", url: `/api/v1/jobs/${id}/cancel`, headers: alice.headers });

    expect((await cancel(first!)).json()).toEqual({ status: "cancelled" });
    expect(await balance(alice.userId)).toBe(60 - SHOTS + 1);
    expect(await h.runs.queues.has("images", "mock", first!)).toBe(false);
    expect((await cancel(first!)).statusCode).toBe(409);
    expect(await balance(alice.userId)).toBe(60 - SHOTS + 1);

    await h.database.db.update(generationJob).set({ status: "active", startedAt: new Date() }).where(eq(generationJob.id, second!));
    expect((await cancel(second!)).json()).toEqual({ status: "cancelling" });
    expect(await h.runs.redis.get(cancelKey(second!))).toBe("1");

    await h.database.db.update(generationJob).set({ status: "completed" }).where(eq(generationJob.id, third!));
    expect((await cancel(third!)).statusCode).toBe(409);
  });

  it("runs a failed job again with a new seed and a new reservation", async () => {
    const alice = await account("alice@example.test");
    const { listingId } = await readyListing(alice);
    const run = (await h.app.inject({ method: "POST", url: `/api/v1/listings/${listingId}/generations`, headers: alice.headers, payload: {} })).json();
    const failed = run.jobIds[0] as string;
    await h.database.db.update(generationJob).set({ status: "failed" }).where(eq(generationJob.id, failed));
    const res = await h.app.inject({ method: "POST", url: `/api/v1/jobs/${failed}/retry`, headers: alice.headers });
    expect(res.statusCode).toBe(202);
    const retried = res.json().jobIds[0] as string;
    const [oldJob] = await h.database.db.select().from(generationJob).where(eq(generationJob.id, failed));
    const [newJob] = await h.database.db.select().from(generationJob).where(eq(generationJob.id, retried));
    expect(newJob).toMatchObject({ generationId: oldJob!.generationId, prompt: oldJob!.prompt, shotId: oldJob!.shotId });
    expect(newJob!.seed).not.toBe(oldJob!.seed);
    expect(await balance(alice.userId)).toBe(60 - SHOTS - 1);
    expect((await h.app.inject({ method: "POST", url: `/api/v1/jobs/${retried}/retry`, headers: alice.headers })).statusCode).toBe(409);
  });

  it("answers 404 for another user's listing or job on every run route", async () => {
    const alice = await account("alice@example.test");
    const bob = await account("bob@example.test");
    const { listingId } = await readyListing(alice);
    const run = (await h.app.inject({ method: "POST", url: `/api/v1/listings/${listingId}/generations`, headers: alice.headers, payload: {} })).json();
    const job = run.jobIds[0] as string;
    await h.database.db.update(generationJob).set({ status: "failed" }).where(eq(generationJob.id, run.jobIds[1]));
    for (const [url, payload] of [
      [`/api/v1/listings/${listingId}/generations`, {}],
      [`/api/v1/listings/${listingId}/copy`, { language: "en" }],
      [`/api/v1/jobs/${job}/cancel`, undefined],
      [`/api/v1/jobs/${run.jobIds[1]}/retry`, undefined],
    ] as const) {
      const res = await h.app.inject({ method: "POST", url, headers: bob.headers, ...(payload ? { payload } : {}) });
      expect(res.statusCode, url).toBe(404);
    }
    expect((await h.database.db.select().from(generationJob).where(eq(generationJob.id, job)))[0]?.status).not.toBe("cancelled");
  });
});

describe("Cloudflare budget guard", () => {
  it("counts neurons per UTC day and refuses what would cross the budget", async () => {
    const budget = new NeuronBudget(h.runs.redis, 300);
    const day = new Date("2026-10-12T23:00:00Z");
    expect(await budget.allows(220, day)).toBe(true);
    await budget.record(220, day);
    expect(await budget.allows(110, day)).toBe(false);
    expect(await budget.allows(80, day)).toBe(true);
    expect(await budget.allows(110, new Date("2026-10-13T00:00:01Z"))).toBe(true);
  });
});
