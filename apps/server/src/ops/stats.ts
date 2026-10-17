import { sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { Db } from "../db/client";
import { WORKER_HEARTBEATS_KEY, WORKER_STALE_MS } from "../worker/liveness";

/** What the owner reads on the host (`docker compose exec api node dist/stats.js`): counts only, nothing personal. */
export interface Stats {
  at: string;
  /** Jobs not finished yet, by status. */
  queue: Record<string, number>;
  /** Jobs created in the last 24 hours, by status. */
  jobsLast24h: Record<string, number>;
  failedLastHour: number;
  /** Verified accounts created per day, last 7 days (UTC). */
  signupsPerDay: Record<string, number>;
  /** Credits granted, spent (reserved) and refunded in the last 7 days. */
  credits: { granted7d: number; reserved7d: number; refunded7d: number };
  workersAlive: number;
}

const num = (v: unknown) => Number(v ?? 0);

export async function collectStats(db: Db, redis: Pick<Redis, "zcount">, now: Date = new Date()): Promise<Stats> {
  const at = now.toISOString();
  const queue = await db.execute<{ status: string; n: string }>(
    sql`select status, count(*) as n from generation_job where status in ('queued', 'dispatched', 'active') group by status`,
  );
  const last24 = await db.execute<{ status: string; n: string }>(
    sql`select status, count(*) as n from generation_job where created_at > ${at}::timestamptz - interval '24 hours' group by status`,
  );
  const failed = await db.execute<{ n: string }>(
    sql`select count(*) as n from generation_job where status = 'failed' and completed_at > ${at}::timestamptz - interval '1 hour'`,
  );
  const signups = await db.execute<{ day: string; n: string }>(
    sql`select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') as day, count(*) as n from "user"
        where email_verified and created_at > ${at}::timestamptz - interval '7 days' group by day order by day`,
  );
  const credits = await db.execute<{ reason: string; total: string }>(
    sql`select reason, sum(delta) as total from credit_ledger where created_at > ${at}::timestamptz - interval '7 days' group by reason`,
  );
  const byReason = Object.fromEntries(credits.rows.map((r) => [r.reason, num(r.total)]));
  return {
    at,
    queue: Object.fromEntries(queue.rows.map((r) => [r.status, num(r.n)])),
    jobsLast24h: Object.fromEntries(last24.rows.map((r) => [r.status, num(r.n)])),
    failedLastHour: num(failed.rows[0]?.n),
    signupsPerDay: Object.fromEntries(signups.rows.map((r) => [r.day, num(r.n)])),
    credits: { granted7d: num(byReason.grant), reserved7d: -num(byReason.reserve), refunded7d: num(byReason.refund) },
    workersAlive: num(await redis.zcount(WORKER_HEARTBEATS_KEY, now.getTime() - WORKER_STALE_MS, "+inf")),
  };
}
