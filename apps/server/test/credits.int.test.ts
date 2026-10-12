import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createId } from "@aiv/domain/lib/ids";
import { ensureMonthlyGrant, readCredits, refund, reserve } from "../src/credits/ledger";
import { creditBalance, creditLedger, user } from "../src/db/schema";
import { signIn, startHarness, verifiedUser, type Harness } from "./app-harness";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());
beforeEach(() => h.reset());

async function userId(email: string): Promise<string> {
  await h.database.db.insert(user).values({ id: email.split("@")[0]!, name: "U", email, emailVerified: true });
  return email.split("@")[0]!;
}

const balanceOf = async (id: string) => (await h.database.db.select().from(creditBalance).where(eq(creditBalance.userId, id)))[0]?.balance;

describe("credit ledger", () => {
  it("grants the month's free credits once, and again the next month", async () => {
    const id = await userId("alice@example.test");
    const db = h.database.db;
    await db.transaction((tx) => ensureMonthlyGrant(tx, id, 60, new Date("2026-10-12T10:00:00Z")));
    await db.transaction((tx) => ensureMonthlyGrant(tx, id, 60, new Date("2026-10-31T23:59:00Z")));
    expect(await balanceOf(id)).toBe(60);
    await db.transaction((tx) => ensureMonthlyGrant(tx, id, 60, new Date("2026-11-01T00:00:00Z")));
    expect(await balanceOf(id)).toBe(120);
    expect((await readCredits(db, id)).ledger.map((e) => e.idempotencyKey).sort()).toEqual([`grant:${id}:2026-10`, `grant:${id}:2026-11`]);
  });

  it("never goes negative under concurrent reservations", async () => {
    const id = await userId("alice@example.test");
    await h.database.db.transaction((tx) => ensureMonthlyGrant(tx, id, 10));
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () => h.database.db.transaction((tx) => reserve(tx, id, 1, { generationId: createId("gen") }))),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
    const refused = results.filter((r) => r.status === "rejected");
    expect(refused).toHaveLength(10);
    for (const r of refused) expect((r as PromiseRejectedResult).reason).toMatchObject({ status: 402, code: "INSUFFICIENT_CREDITS" });
    expect(await balanceOf(id)).toBe(0);
  });

  it("serializes reservations on the balance row: a reservation waiting behind another sees its result", async () => {
    const id = await userId("bob@example.test");
    await h.database.db.transaction((tx) => ensureMonthlyGrant(tx, id, 1));
    let releaseA!: () => void;
    const aMayCommit = new Promise<void>((resolve) => (releaseA = resolve));
    let aReserved!: () => void;
    const aHasReserved = new Promise<void>((resolve) => (aReserved = resolve));
    const a = h.database.db.transaction(async (tx) => {
      await reserve(tx, id, 1, { generationId: createId("gen") });
      aReserved();
      await aMayCommit;
    });
    await aHasReserved;
    const b = h.database.db.transaction((tx) => reserve(tx, id, 1, { generationId: createId("gen") }));
    await new Promise((r) => setTimeout(r, 200));
    releaseA();
    await a;
    await expect(b).rejects.toMatchObject({ status: 402, code: "INSUFFICIENT_CREDITS" });
    expect(await balanceOf(id)).toBe(0);
  });

  it("writes nothing when the balance is short, and the reservation rolls back with its transaction", async () => {
    const id = await userId("alice@example.test");
    await h.database.db.transaction((tx) => ensureMonthlyGrant(tx, id, 3));
    await expect(h.database.db.transaction((tx) => reserve(tx, id, 5, { generationId: createId("gen") }))).rejects.toMatchObject({
      code: "INSUFFICIENT_CREDITS",
    });
    await expect(
      h.database.db.transaction(async (tx) => {
        await reserve(tx, id, 2, { generationId: createId("gen") });
        throw new Error("job insert failed");
      }),
    ).rejects.toThrow("job insert failed");
    expect(await balanceOf(id)).toBe(3);
    expect((await h.database.db.select().from(creditLedger)).map((e) => e.reason)).toEqual(["grant"]);
  });

  it("refunds a job once, however many times it is asked", async () => {
    const id = await userId("alice@example.test");
    const generationId = createId("gen");
    const jobId = createId("job");
    await h.database.db.transaction((tx) => ensureMonthlyGrant(tx, id, 5));
    await h.database.db.transaction((tx) => reserve(tx, id, 2, { generationId }));
    const first = await h.database.db.transaction((tx) => refund(tx, { userId: id, jobId, credits: 1, generationId }));
    const second = await h.database.db.transaction((tx) => refund(tx, { userId: id, jobId, credits: 1, generationId }));
    expect([first, second]).toEqual([true, false]);
    expect(await balanceOf(id)).toBe(4);
  });
});

describe("GET /api/v1/credits", () => {
  it("shows the free monthly credits and the latest movements, to the signed-in user only", async () => {
    await verifiedUser(h, "alice@example.test");
    const token = String((await signIn(h, "alice@example.test")).headers["set-auth-token"]);
    const res = await h.app.inject({ method: "GET", url: "/api/v1/credits", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ balance: 60, plan: "free", ledger: [{ delta: 60, reason: "grant" }] });
    expect((await h.app.inject({ method: "GET", url: "/api/v1/credits" })).statusCode).toBe(401);
  });
});
