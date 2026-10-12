import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createId } from "@aiv/domain/lib/ids";
import { creditBalance, creditLedger, generation, generationJob, listing, user } from "../src/db/schema";
import { openTestDatabase, truncateAll } from "./db-harness";

const database = openTestDatabase();
const { db } = database;
afterAll(() => database.close());
beforeEach(() => truncateAll(database));

async function seed(): Promise<{ listingId: string; generationId: string; jobId: string }> {
  await db.insert(user).values({ id: "u_alice", name: "Alice", email: "alice@example.test", emailVerified: true });
  const listingId = createId("lst");
  const generationId = createId("gen");
  const jobId = createId("job");
  await db.insert(listing).values({ id: listingId, userId: "u_alice", name: "Shirt" });
  await db.insert(generation).values({
    id: generationId,
    listingId,
    userId: "u_alice",
    kind: "images",
    settings: { providerId: "mock", modelId: "mock-1", aspectRatio: "original", variationCount: 1 },
  });
  await db
    .insert(generationJob)
    .values({ id: jobId, generationId, listingId, userId: "u_alice", kind: "images", index: 0, prompt: "p", provider: "mock", model: "mock-1", credits: 1 });
  return { listingId, generationId, jobId };
}

describe("generation and credit schema", () => {
  it("refuses a negative balance and a reused idempotency key", async () => {
    await seed();
    await db.insert(creditBalance).values({ userId: "u_alice", balance: 1 });
    await expect(db.update(creditBalance).set({ balance: -1 }).where(eq(creditBalance.userId, "u_alice"))).rejects.toMatchObject({
      cause: { constraint: "credit_balance_non_negative" },
    });
    const entry = { userId: "u_alice", delta: 60, reason: "grant" as const, idempotencyKey: "grant:u_alice:2026-10" };
    await db.insert(creditLedger).values({ id: randomUUID(), ...entry });
    await expect(db.insert(creditLedger).values({ id: randomUUID(), ...entry })).rejects.toMatchObject({ cause: { code: "23505" } });
  });

  it("refuses unknown job statuses", async () => {
    const { jobId } = await seed();
    await expect(
      db
        .update(generationJob)
        .set({ status: "running" as never })
        .where(eq(generationJob.id, jobId)),
    ).rejects.toMatchObject({
      cause: { constraint: "generation_job_status_check" },
    });
  });

  it("removes generations, jobs, ledger and balance with the user, and jobs with their listing", async () => {
    const { listingId } = await seed();
    await db.insert(creditBalance).values({ userId: "u_alice", balance: 3 });
    await db.insert(creditLedger).values({ id: randomUUID(), userId: "u_alice", delta: 3, reason: "grant", idempotencyKey: "grant:u_alice:x" });
    await db.delete(listing).where(eq(listing.id, listingId));
    expect(await db.select().from(generationJob)).toEqual([]);
    expect(await db.select().from(generation)).toEqual([]);
    await db.delete(user).where(eq(user.id, "u_alice"));
    expect(await db.select().from(creditLedger)).toEqual([]);
    expect(await db.select().from(creditBalance)).toEqual([]);
  });
});
