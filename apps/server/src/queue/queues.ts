// BullMQ 6.3 (docs.bullmq.io: guide/connections, guide/queues/adding-bulks, guide/jobs/job-ids, guide/retrying-failing-jobs,
// guide/rate-limiting; checked 2026-10-12). Job data carries our job id only — prompts, images and emails stay in
// Postgres and the object store.
import { Queue, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";
import type { GenerationKind } from "../db/schema";

/** BullMQ connections must not give up on a command (`maxRetriesPerRequest: null`, required for workers). */
export function createQueueConnection(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}

export interface QueueJobData {
  jobId: string;
}

/** One queue per job kind and provider, so each provider gets its own rate limiter (`gen-cloudflare`, `copy-gemini`…). */
export function queueName(kind: GenerationKind, provider: string): string {
  if (!/^[a-z0-9-]{1,40}$/.test(provider)) throw new Error("Invalid provider id");
  return `${kind === "images" ? "gen" : "copy"}-${provider}`;
}

export interface QueueSetOptions {
  connection: Redis;
  /** Automatic attempts per job (the first included). */
  attempts: number;
  /** Key prefix in Redis (tests isolate themselves with their own). */
  prefix?: string;
}

/** The queues the api and the worker share; created on demand and closed together. */
export class QueueSet {
  private readonly queues = new Map<string, Queue<QueueJobData>>();

  constructor(private readonly options: QueueSetOptions) {}

  get(kind: GenerationKind, provider: string): Queue<QueueJobData> {
    const name = queueName(kind, provider);
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue<QueueJobData>(name, { connection: this.options.connection, ...(this.options.prefix ? { prefix: this.options.prefix } : {}) });
      this.queues.set(name, queue);
    }
    return queue;
  }

  /** Our job id is the BullMQ job id: adding the same job twice is a no-op. */
  jobOptions(jobId: string): JobsOptions {
    return {
      jobId,
      attempts: this.options.attempts,
      backoff: { type: "domain" },
      removeOnComplete: { count: 1000 },
      removeOnFail: { count: 1000 },
    };
  }

  async add(kind: GenerationKind, provider: string, jobId: string): Promise<void> {
    await this.get(kind, provider).add("run", { jobId }, this.jobOptions(jobId));
  }

  /** Whether BullMQ still holds this job (waiting, delayed, active, or kept after completion/failure). */
  async has(kind: GenerationKind, provider: string, jobId: string): Promise<boolean> {
    return (await this.get(kind, provider).getJob(jobId)) !== undefined;
  }

  get prefix(): string | undefined {
    return this.options.prefix;
  }

  get connection(): Redis {
    return this.options.connection;
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
  }
}
