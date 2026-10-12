import { and, eq, lt, inArray, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../db/client";
import { generationJob } from "../db/schema";
import type { Dispatcher } from "./dispatcher";
import type { QueueSet } from "./queues";

export interface ReconcileReport {
  readded: number;
  revived: number;
  offeredUsers: number;
}

/**
 * Closes the gaps a crash can leave between Postgres and BullMQ (run every minute by the worker):
 * - `dispatched` rows unknown to BullMQ (the process died between the update and the add) are added again;
 * - `active` rows whose BullMQ job is gone and that started longer ago than `staleAfterMs` go back to
 *   `dispatched` and are added again (BullMQ's own stalled-job check covers jobs it still holds);
 * - every user with queued jobs is offered again, in case an offer was skipped.
 * Adding is idempotent (our job id is the BullMQ id), so running it twice is harmless.
 */
export async function reconcile(
  deps: { db: Db; queues: QueueSet; dispatcher: Dispatcher; log: Pick<FastifyBaseLogger, "warn"> },
  options: { staleAfterMs: number; now?: Date },
): Promise<ReconcileReport> {
  const { db, queues, dispatcher, log } = deps;
  const now = options.now ?? new Date();
  const report: ReconcileReport = { readded: 0, revived: 0, offeredUsers: 0 };

  const dispatched = await db
    .select({ id: generationJob.id, kind: generationJob.kind, provider: generationJob.provider })
    .from(generationJob)
    .where(eq(generationJob.status, "dispatched"));
  for (const job of dispatched) {
    if (await queues.has(job.kind, job.provider, job.id)) continue;
    await queues.add(job.kind, job.provider, job.id);
    report.readded++;
  }

  const stale = await db
    .select({ id: generationJob.id, kind: generationJob.kind, provider: generationJob.provider })
    .from(generationJob)
    .where(and(eq(generationJob.status, "active"), lt(generationJob.startedAt, new Date(now.getTime() - options.staleAfterMs))));
  for (const job of stale) {
    if (await queues.has(job.kind, job.provider, job.id)) continue;
    const [revived] = await db
      .update(generationJob)
      .set({ status: "dispatched", dispatchedAt: now })
      .where(and(eq(generationJob.id, job.id), eq(generationJob.status, "active")))
      .returning({ id: generationJob.id });
    if (!revived) continue;
    await queues.add(job.kind, job.provider, job.id);
    report.revived++;
    log.warn({ jobId: job.id }, "stale active job sent back to its queue");
  }

  const users = await db
    .selectDistinct({ userId: generationJob.userId })
    .from(generationJob)
    .where(inArray(generationJob.status, ["queued"]))
    .orderBy(sql`1`);
  for (const { userId } of users) {
    await dispatcher.offer(userId);
    report.offeredUsers++;
  }
  return report;
}
