import { randomUUID } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { creditBalance, creditLedger } from "../db/schema";
import { HttpError } from "../http/errors";

/** A connection or an open transaction: ledger functions run inside the caller's transaction when given one. */
export type Tx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/** `2026-10` — the month a free grant belongs to (UTC). */
export function grantMonth(now: Date): string {
  return now.toISOString().slice(0, 7);
}

/**
 * Inserts one ledger row and moves the balance by `delta`, unless a row with this idempotency key exists
 * (then nothing happens). Returns whether the movement was applied. Must run inside a transaction that locked
 * the balance row (`lockBalance`).
 */
async function applyMovement(
  tx: Tx,
  movement: { userId: string; delta: number; reason: "grant" | "reserve" | "refund" | "adjust"; key: string; jobId?: string; generationId?: string },
): Promise<boolean> {
  const inserted = await tx
    .insert(creditLedger)
    .values({
      id: randomUUID(),
      userId: movement.userId,
      delta: movement.delta,
      reason: movement.reason,
      idempotencyKey: movement.key,
      ...(movement.jobId ? { jobId: movement.jobId } : {}),
      ...(movement.generationId ? { generationId: movement.generationId } : {}),
    })
    .onConflictDoNothing({ target: creditLedger.idempotencyKey })
    .returning({ id: creditLedger.id });
  if (inserted.length === 0) return false;
  await tx
    .update(creditBalance)
    .set({ balance: sql`${creditBalance.balance} + ${movement.delta}`, updatedAt: new Date() })
    .where(eq(creditBalance.userId, movement.userId));
  return true;
}

/** Creates the balance row if needed and locks it for the rest of the transaction. */
async function lockBalance(tx: Tx, userId: string): Promise<number> {
  await tx.insert(creditBalance).values({ userId }).onConflictDoNothing({ target: creditBalance.userId });
  const [row] = await tx.select({ balance: creditBalance.balance }).from(creditBalance).where(eq(creditBalance.userId, userId)).for("update");
  return row?.balance ?? 0;
}

/** Gives this month's free credits once (key `grant:<userId>:<YYYY-MM>`). Called lazily: on reading or spending credits. */
export async function ensureMonthlyGrant(tx: Tx, userId: string, amount: number, now = new Date()): Promise<void> {
  await lockBalance(tx, userId);
  if (amount > 0) await applyMovement(tx, { userId, delta: amount, reason: "grant", key: `grant:${userId}:${grantMonth(now)}` });
}

/**
 * Reserves `amount` credits for a generation (key `reserve:<generationId>`), inside the transaction that creates
 * its jobs: both commit or neither does. Short balance → 402 INSUFFICIENT_CREDITS and nothing written.
 */
export async function reserve(tx: Tx, userId: string, amount: number, generationId: string): Promise<void> {
  const balance = await lockBalance(tx, userId);
  if (balance < amount) throw new HttpError(402, "INSUFFICIENT_CREDITS", "Not enough credits for this run.");
  await applyMovement(tx, { userId, delta: -amount, reason: "reserve", key: `reserve:${generationId}`, generationId });
}

/** Gives a job's credits back (key `refund:<jobId>`): a second call for the same job does nothing. */
export async function refund(tx: Tx, job: { userId: string; jobId: string; credits: number; generationId: string }): Promise<boolean> {
  if (job.credits <= 0) return false;
  await lockBalance(tx, job.userId);
  return applyMovement(tx, {
    userId: job.userId,
    delta: job.credits,
    reason: "refund",
    key: `refund:${job.jobId}`,
    jobId: job.jobId,
    generationId: job.generationId,
  });
}

export async function readCredits(db: Db, userId: string, limit = 50) {
  const [balance] = await db.select().from(creditBalance).where(eq(creditBalance.userId, userId));
  const ledger = await db.select().from(creditLedger).where(eq(creditLedger.userId, userId)).orderBy(desc(creditLedger.createdAt)).limit(limit);
  return { balance: balance?.balance ?? 0, plan: balance?.plan ?? "free", ledger };
}
