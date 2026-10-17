// BullMQ workers (docs.bullmq.io: guide/workers, guide/workers/graceful-shutdown, guide/rate-limiting,
// guide/retrying-failing-jobs#custom-backoff-strategy, guide/job-schedulers; checked 2026-10-12).
import { Queue, Worker } from "bullmq";
import type { Redis } from "ioredis";
import { computeBackoffMs } from "@aiv/domain/lib/retry";
import type { QueueJobData, QueueSet } from "../queue/queues";
import { queueName } from "../queue/queues";
import { reconcile } from "../queue/reconciler";
import { checkCreditDrift, purgeUnverifiedAccounts, sweepOrphans } from "../maintenance/maintenance";
import { RetryLater, runJob, type RunJobDeps } from "./run-job";

export interface WorkerOptions {
  connection: Redis;
  queues: QueueSet;
  copyProvider: string;
  concurrency: number;
  /** Provider requests per minute, per queue (the platform account's limits). */
  maxPerMinute: { image: number; copy: number };
  reconcileEveryMs?: number;
  backoff?: { baseMs: number; maxMs: number };
}

export interface RunningWorkers {
  close(): Promise<void>;
}

const MAINTENANCE_QUEUE = "maintenance";

/** Exponential backoff with full jitter (the domain's), never sooner than the provider's Retry-After. */
export function backoffFor(attemptsMade: number, error: unknown, opts: { baseMs: number; maxMs: number }): number {
  const computed = computeBackoffMs(attemptsMade, opts);
  const retryAfter = error instanceof RetryLater ? (error.error.retryAfterMs ?? 0) : 0;
  return Math.max(computed, retryAfter);
}

/** Starts one worker per queue the platform uses, plus the maintenance worker (reconciler every minute). */
export async function startWorkers(deps: RunJobDeps, options: WorkerOptions): Promise<RunningWorkers> {
  const backoff = options.backoff ?? { baseMs: 2_000, maxMs: 60_000 };
  const prefix = options.queues.prefix;
  const common = {
    connection: options.connection,
    ...(prefix ? { prefix } : {}),
    concurrency: options.concurrency,
    settings: { backoffStrategy: (attemptsMade: number, _type?: string, err?: Error) => backoffFor(attemptsMade, err, backoff) },
  };
  const process = async (job: { data: QueueJobData; attemptsMade: number }) => runJob(deps, { jobId: job.data.jobId, attemptsMade: job.attemptsMade });
  const workers = [
    new Worker<QueueJobData>(queueName("images", deps.imageProvider), process, { ...common, limiter: { max: options.maxPerMinute.image, duration: 60_000 } }),
    new Worker<QueueJobData>(queueName("copy", options.copyProvider), process, { ...common, limiter: { max: options.maxPerMinute.copy, duration: 60_000 } }),
  ];

  const maintenanceQueue = new Queue(MAINTENANCE_QUEUE, { connection: options.connection, ...(prefix ? { prefix } : {}) });
  await maintenanceQueue.upsertJobScheduler("reconcile", { every: options.reconcileEveryMs ?? 60_000 }, { name: "reconcile" });
  // Nightly, UTC: orphaned image objects older than a day, then the balance/ledger check.
  await maintenanceQueue.upsertJobScheduler("sweep", { pattern: "0 3 * * *", tz: "UTC" }, { name: "sweep" });
  await maintenanceQueue.upsertJobScheduler("drift", { pattern: "30 3 * * *", tz: "UTC" }, { name: "drift" });
  // Accounts that never verified their email are removed after 7 days (PRIVACY.md → retention).
  await maintenanceQueue.upsertJobScheduler("purge-unverified", { pattern: "45 3 * * *", tz: "UTC" }, { name: "purge-unverified" });
  const maintenance = new Worker(
    MAINTENANCE_QUEUE,
    async (job) => {
      if (job.name === "sweep") return void (await sweepOrphans(deps.db, deps.store, deps.log, { minAgeMs: 24 * 3600 * 1000 }));
      if (job.name === "drift") return void (await checkCreditDrift(deps.db, deps.log));
      if (job.name === "purge-unverified") return void (await purgeUnverifiedAccounts(deps.db, deps.store, deps.log, { olderThanMs: 7 * 24 * 3600 * 1000 }));
      const report = await reconcile({ db: deps.db, queues: options.queues, dispatcher: deps.dispatcher, log: deps.log }, { staleAfterMs: deps.timeoutMs * 2 });
      if (report.readded + report.revived > 0) deps.log.warn(report, "reconciler repaired jobs");
    },
    { connection: options.connection, ...(prefix ? { prefix } : {}), concurrency: 1 },
  );
  for (const w of [...workers, maintenance]) w.on("error", (error) => deps.log.error({ err: error }, "worker error"));

  return {
    /** Waits for running jobs to finish (graceful shutdown). */
    async close() {
      await Promise.all([...workers, maintenance].map((w) => w.close()));
      await maintenanceQueue.close();
    },
  };
}
