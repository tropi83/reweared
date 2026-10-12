import { inArray, sql } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { Db } from "../db/client";
import { imageAsset } from "../db/schema";
import type { ObjectStore } from "../storage/object-store";

/** `u/<user>/l/<listing>/<bucket>/<asset>.<ext>` → the asset id, or undefined for anything else. */
function assetIdOf(key: string): string | undefined {
  return key.match(/^u\/[A-Za-z0-9_-]{1,64}\/l\/[a-z]{3}_[a-f0-9]{8,64}\/(?:original|generation|thumbnail)\/([a-z]{3}_[a-f0-9]{8,64})\.(?:png|jpg|webp)$/)?.[1];
}

export interface SweepReport {
  scanned: number;
  deleted: number;
  /** Keys that do not follow the layout: left alone and reported. */
  unknown: number;
}

/**
 * Deletes image objects no database row points to — left by an account or listing deleted while the store was
 * down, or by a crash between storing bytes and writing the row — once they are older than `minAgeMs` (so an
 * upload in progress is never touched). Keys outside the layout are only counted.
 */
export async function sweepOrphans(
  db: Db,
  store: ObjectStore,
  log: Pick<FastifyBaseLogger, "info" | "warn">,
  options: { minAgeMs: number; now?: Date },
): Promise<SweepReport> {
  const now = options.now ?? new Date();
  const report: SweepReport = { scanned: 0, deleted: 0, unknown: 0 };
  for await (const page of store.list("u/")) {
    report.scanned += page.length;
    const candidates = page.filter((o) => now.getTime() - o.lastModified.getTime() >= options.minAgeMs);
    const ids = [...new Set(candidates.map((o) => assetIdOf(o.key)).filter((id): id is string => id !== undefined))];
    const known = new Set<string>();
    if (ids.length > 0) {
      const rows = await db
        .select({ id: imageAsset.id, objectKey: imageAsset.objectKey, thumbKey: imageAsset.thumbKey })
        .from(imageAsset)
        .where(inArray(imageAsset.id, ids));
      for (const row of rows) {
        known.add(row.objectKey);
        known.add(row.thumbKey);
      }
    }
    for (const object of candidates) {
      if (!assetIdOf(object.key)) {
        report.unknown++;
        continue;
      }
      if (known.has(object.key)) continue;
      await store.delete(object.key);
      report.deleted++;
    }
  }
  if (report.unknown > 0) log.warn(report, "objects outside the storage layout");
  log.info(report, "orphan sweep done");
  return report;
}

export interface DriftReport {
  checked: number;
  drifting: Array<{ userId: string; balance: number; ledger: number }>;
}

/** Compares every balance with the sum of its ledger. A difference is logged as an error, never corrected here. */
export async function checkCreditDrift(db: Db, log: Pick<FastifyBaseLogger, "info" | "error">): Promise<DriftReport> {
  const rows = await db.execute<{ user_id: string; balance: number; ledger: number }>(sql`
    select b.user_id, b.balance, coalesce(sum(l.delta), 0)::int as ledger
    from credit_balance b left join credit_ledger l on l.user_id = b.user_id
    group by b.user_id, b.balance`);
  const drifting = rows.rows
    .filter((r) => Number(r.balance) !== Number(r.ledger))
    .map((r) => ({ userId: r.user_id, balance: Number(r.balance), ledger: Number(r.ledger) }));
  if (drifting.length > 0) log.error({ drifting }, "credit balances differ from their ledger");
  else log.info({ checked: rows.rows.length }, "credit balances match their ledger");
  return { checked: rows.rows.length, drifting };
}
