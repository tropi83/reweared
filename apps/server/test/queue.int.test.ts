import { afterAll, beforeEach, describe, expect, inject, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createId } from "@aiv/domain/lib/ids";
import { generation, generationJob, listing, user } from "../src/db/schema";
import { Dispatcher } from "../src/queue/dispatcher";
import { QueueSet, createQueueConnection } from "../src/queue/queues";
import { reconcile } from "../src/queue/reconciler";
import { openTestDatabase, truncateAll } from "./db-harness";

const database = openTestDatabase();
const { db } = database;
const redis = createQueueConnection(inject("redisUrl"));
const queues = new QueueSet({ connection: redis, attempts: 3, prefix: "test-q" });
const silent = { warn() {}, error() {} };
const dispatcher = new Dispatcher({ db, redis, queues, maxActivePerUser: 4, log: silent });

afterAll(async () => {
  await queues.close();
  redis.disconnect();
  await database.close();
});
beforeEach(async () => {
  await truncateAll(database);
  await redis.flushdb();
});

/** A user with one listing and `count` queued image jobs, created `ageMs` ago (oldest first). */
async function backlog(userId: string, count: number, ageMs = 0): Promise<string[]> {
  await db
    .insert(user)
    .values({ id: userId, name: userId, email: `${userId}@example.test`, emailVerified: true })
    .onConflictDoNothing();
  const listingId = createId("lst");
  const generationId = createId("gen");
  await db.insert(listing).values({ id: listingId, userId, name: "L" });
  await db.insert(generation).values({
    id: generationId,
    listingId,
    userId,
    kind: "images",
    settings: { providerId: "mock", modelId: "m", aspectRatio: "original", variationCount: count },
  });
  const ids = Array.from({ length: count }, () => createId("job"));
  const created = new Date(Date.now() - ageMs);
  await db.insert(generationJob).values(
    ids.map((id, index) => ({
      id,
      generationId,
      listingId,
      userId,
      kind: "images" as const,
      index,
      prompt: "p",
      provider: "mock",
      model: "m",
      credits: 1,
      createdAt: created,
    })),
  );
  return ids;
}

const statusCount = async (userId: string, status: "queued" | "dispatched") =>
  (
    await db
      .select()
      .from(generationJob)
      .where(and(eq(generationJob.userId, userId), eq(generationJob.status, status)))
  ).length;

describe("dispatcher", () => {
  it("keeps at most N jobs per user in BullMQ, oldest first, so a big backlog cannot starve another user", async () => {
    const aliceJobs = await backlog("alice", 20, 60_000);
    const bobJobs = await backlog("bob", 2);
    expect(await dispatcher.offer("alice")).toEqual(aliceJobs.slice(0, 4));
    expect(await dispatcher.offer("bob")).toEqual(bobJobs);
    expect(await statusCount("alice", "dispatched")).toBe(4);
    expect(await statusCount("alice", "queued")).toBe(16);
    for (const id of [...aliceJobs.slice(0, 4), ...bobJobs]) expect(await queues.has("images", "mock", id)).toBe(true);
    expect(await queues.has("images", "mock", aliceJobs[4]!)).toBe(false);

    // One of Alice's jobs ends: her next one is dispatched.
    await db.update(generationJob).set({ status: "completed" }).where(eq(generationJob.id, aliceJobs[0]!));
    expect(await dispatcher.offer("alice")).toEqual([aliceJobs[4]]);
  });

  it("holds the cap under concurrent offers", async () => {
    await backlog("alice", 20);
    await Promise.all(Array.from({ length: 10 }, () => dispatcher.offer("alice")));
    expect(await statusCount("alice", "dispatched")).toBe(4);
    expect(await queues.get("images", "mock").getWaitingCount()).toBe(4);
  });

  it("adds a job once even when offered twice", async () => {
    const [id] = await backlog("alice", 1);
    await dispatcher.offer("alice");
    await queues.add("images", "mock", id!);
    expect(await queues.get("images", "mock").getWaitingCount()).toBe(1);
  });
});

describe("reconciler", () => {
  it("re-adds a dispatched job BullMQ never received (crash between the update and the add)", async () => {
    const [id] = await backlog("alice", 1);
    await db.update(generationJob).set({ status: "dispatched", dispatchedAt: new Date() }).where(eq(generationJob.id, id!));
    expect(await queues.has("images", "mock", id!)).toBe(false);
    const report = await reconcile({ db, queues, dispatcher, log: silent }, { staleAfterMs: 60_000 });
    expect(report.readded).toBe(1);
    expect(await queues.has("images", "mock", id!)).toBe(true);
  });

  it("sends a stale active job whose BullMQ job is gone back to its queue, and offers waiting users", async () => {
    const [stale, fresh] = await backlog("alice", 2);
    await db
      .update(generationJob)
      .set({ status: "active", startedAt: new Date(Date.now() - 10 * 60_000) })
      .where(eq(generationJob.id, stale!));
    await db.update(generationJob).set({ status: "active", startedAt: new Date() }).where(eq(generationJob.id, fresh!));
    await backlog("bob", 3);
    const report = await reconcile({ db, queues, dispatcher, log: silent }, { staleAfterMs: 5 * 60_000 });
    expect(report.revived).toBe(1);
    expect((await db.select().from(generationJob).where(eq(generationJob.id, stale!)))[0]?.status).toBe("dispatched");
    expect((await db.select().from(generationJob).where(eq(generationJob.id, fresh!)))[0]?.status).toBe("active");
    expect(await statusCount("bob", "dispatched")).toBe(3);
  });
});
