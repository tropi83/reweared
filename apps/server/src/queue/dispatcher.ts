import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../db/client";
import { generationJob } from "../db/schema";
import type { QueueSet } from "./queues";

const LOCK_TTL_MS = 10_000;
const RELEASE = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;

export interface DispatcherOptions {
  db: Db;
  redis: Redis;
  queues: QueueSet;
  /** Most jobs of one user BullMQ may hold at once (fairness between users). */
  maxActivePerUser: number;
  log: Pick<FastifyBaseLogger, "warn" | "error">;
}

/**
 * Feeds BullMQ from the Postgres backlog, at most `maxActivePerUser` jobs per user at a time, oldest first: a user
 * with 50 queued photos cannot delay another user's 5. Runs under a Redis lock per user so concurrent offers
 * never exceed the cap. A job is marked `dispatched` before it is added; if the add fails, the reconciler adds it.
 */
export class Dispatcher {
  constructor(private readonly options: DispatcherOptions) {}

  /** Dispatches what the user's free slots allow. Returns the job ids added to BullMQ. */
  async offer(userId: string): Promise<string[]> {
    const { redis, db, queues, maxActivePerUser, log } = this.options;
    const lockKey = `lock:dispatch:${userId}`;
    const token = randomUUID();
    let locked = false;
    for (let attempt = 0; attempt < 50 && !locked; attempt++) {
      locked = (await redis.set(lockKey, token, "PX", LOCK_TTL_MS, "NX")) === "OK";
      if (!locked) await new Promise((r) => setTimeout(r, 20));
    }
    // Another offer for this user is running and will see our jobs; the reconciler is the safety net.
    if (!locked) return [];
    try {
      const [{ busy = 0 } = {}] = await db
        .select({ busy: sql<number>`count(*)::int` })
        .from(generationJob)
        .where(and(eq(generationJob.userId, userId), inArray(generationJob.status, ["dispatched", "active"])));
      const free = maxActivePerUser - busy;
      if (free <= 0) return [];
      const next = await db
        .select({ id: generationJob.id, kind: generationJob.kind, provider: generationJob.provider })
        .from(generationJob)
        .where(and(eq(generationJob.userId, userId), eq(generationJob.status, "queued")))
        .orderBy(asc(generationJob.createdAt), asc(generationJob.index))
        .limit(free);
      const added: string[] = [];
      for (const job of next) {
        const [marked] = await db
          .update(generationJob)
          .set({ status: "dispatched", dispatchedAt: new Date() })
          .where(and(eq(generationJob.id, job.id), eq(generationJob.status, "queued")))
          .returning({ id: generationJob.id });
        if (!marked) continue;
        try {
          await queues.add(job.kind, job.provider, job.id);
          added.push(job.id);
        } catch (error) {
          log.warn({ err: error, jobId: job.id }, "job not added to its queue; the reconciler will retry");
        }
      }
      return added;
    } finally {
      await redis.eval(RELEASE, 1, lockKey, token).catch((error: unknown) => log.error({ err: error, userId }, "dispatch lock not released"));
    }
  }
}
