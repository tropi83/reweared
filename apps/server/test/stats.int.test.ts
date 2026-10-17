import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { creditLedger, user } from "../src/db/schema";
import { collectStats } from "../src/ops/stats";
import { openTestDatabase, truncateAll } from "./db-harness";

const database = openTestDatabase();
const { db } = database;
afterAll(() => database.close());
beforeEach(() => truncateAll(database));

describe("owner statistics", () => {
  it("counts verified sign-ups per day and the credit movements, and reads the worker heartbeats", async () => {
    await db.insert(user).values([
      { id: "u_a", name: "A", email: "a@example.test", emailVerified: true },
      { id: "u_b", name: "B", email: "b@example.test", emailVerified: true },
      { id: "u_c", name: "C", email: "c@example.test", emailVerified: false },
    ]);
    await db.insert(creditLedger).values([
      { id: randomUUID(), userId: "u_a", delta: 60, reason: "grant", idempotencyKey: "grant:u_a:x" },
      { id: randomUUID(), userId: "u_a", delta: -2, reason: "reserve", idempotencyKey: "reserve:u_a:1" },
      { id: randomUUID(), userId: "u_a", delta: 1, reason: "refund", idempotencyKey: "refund:u_a:1" },
    ]);
    const now = new Date();
    const stats = await collectStats(db, { zcount: async () => 2 }, now);
    const today = now.toISOString().slice(0, 10);
    expect(stats.signupsPerDay).toEqual({ [today]: 2 });
    expect(stats.credits).toEqual({ granted7d: 60, reserved7d: 2, refunded7d: 1 });
    expect(stats.queue).toEqual({});
    expect(stats.failedLastHour).toBe(0);
    expect(stats.workersAlive).toBe(2);
    // Counters only: no email, id or name anywhere in the output.
    expect(JSON.stringify(stats)).not.toMatch(/example\.test|u_a/);
  });
});
