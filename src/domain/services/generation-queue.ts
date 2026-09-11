import { toGenerationError, type GenerationError, type GenerationJob } from "@/domain/models";
import { computeBackoffMs, sleep, withTimeout } from "@/lib/retry";
import { nowIso } from "@/lib/ids";
import type { ImageGenerationRequest, ImageGenerationResult, ImageProvider } from "./image-provider";

export interface QueueDependencies {
  /** Resolves the provider for a job. May throw an AppError (e.g. AUTH_REQUIRED). */
  getProvider(providerId: string): Promise<ImageProvider>;
  /** Builds the provider request (loads + prepares the source image). */
  buildRequest(job: GenerationJob, signal: AbortSignal): Promise<ImageGenerationRequest>;
  /**
   * Persists a successful result and returns the new image asset id.
   * Never called for cancelled jobs.
   */
  persistResult(job: GenerationJob, result: ImageGenerationResult): Promise<string>;
  /** Receives every state transition (snapshot is a fresh copy). */
  onJobUpdate(job: GenerationJob): void;
}

export interface QueueConfig {
  concurrency: number;
  maxAttempts: number;
  timeoutMs: number;
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  /** Injectable for tests. */
  sleep?: typeof sleep;
  random?: () => number;
}

interface Running {
  controller: AbortController;
}

/**
 * Client-side job scheduler: bounded concurrency, per-job timeout, retry with exponential
 * backoff for retryable errors only, and cooperative cancellation.
 *
 * Invariant: a job never stays in `generating`/`queued` once the queue has finished with it.
 */
export class GenerationQueue {
  private readonly pending: GenerationJob[] = [];
  private readonly running = new Map<string, Running>();
  private readonly jobs = new Map<string, GenerationJob>();
  private config: QueueConfig;

  constructor(
    private readonly deps: QueueDependencies,
    config: QueueConfig,
  ) {
    this.config = { ...config };
  }

  configure(patch: Partial<Pick<QueueConfig, "concurrency" | "maxAttempts" | "timeoutMs">>) {
    this.config = { ...this.config, ...patch };
    this.pump();
  }

  get activeCount(): number {
    return this.pending.length + this.running.size;
  }

  getJob(id: string): GenerationJob | undefined {
    return this.jobs.get(id);
  }

  enqueue(jobs: GenerationJob[]): void {
    for (const job of jobs) {
      const queued: GenerationJob = { ...job, status: "queued" };
      delete queued.error;
      delete queued.nextRetryAt;
      this.jobs.set(queued.id, queued);
      this.pending.push(queued);
      this.emit(queued);
    }
    this.pump();
  }

  /** Re-queues a failed or cancelled job. Attempt counter restarts. */
  retry(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job || job.status === "generating" || job.status === "queued") return;
    this.enqueue([{ ...job, attempt: 0, resultImageId: undefined, completedAt: undefined }]);
  }

  cancel(jobId: string): void {
    const pendingIdx = this.pending.findIndex((j) => j.id === jobId);
    if (pendingIdx >= 0) {
      const [job] = this.pending.splice(pendingIdx, 1);
      if (job) this.finish(job, "cancelled");
      return;
    }
    this.running.get(jobId)?.controller.abort();
  }

  cancelGeneration(generationId: string): void {
    for (const job of [...this.pending, ...this.runningJobs()]) {
      if (job.generationId === generationId) this.cancel(job.id);
    }
  }

  cancelAll(): void {
    for (const job of [...this.pending, ...this.runningJobs()]) this.cancel(job.id);
  }

  private runningJobs(): GenerationJob[] {
    return [...this.running.keys()].map((id) => this.jobs.get(id)).filter((j): j is GenerationJob => !!j);
  }

  private pump(): void {
    while (this.running.size < Math.max(1, this.config.concurrency) && this.pending.length > 0) {
      const job = this.pending.shift();
      if (!job) break;
      const controller = new AbortController();
      this.running.set(job.id, { controller });
      void this.run(job, controller).finally(() => {
        this.running.delete(job.id);
        this.pump();
      });
    }
  }

  private async run(initial: GenerationJob, controller: AbortController): Promise<void> {
    let job: GenerationJob = { ...initial, status: "generating", startedAt: nowIso() };
    this.update(job);
    const doSleep = this.config.sleep ?? sleep;

    for (;;) {
      job = { ...job, attempt: job.attempt + 1 };
      delete job.nextRetryAt;
      this.update(job);

      const timeout = withTimeout(this.config.timeoutMs, controller.signal);
      try {
        const provider = await this.deps.getProvider(job.provider);
        const request = await this.deps.buildRequest(job, timeout.signal);
        const result = await provider.generate(request, { signal: timeout.signal });
        timeout.clear();
        if (controller.signal.aborted) {
          this.finish(job, "cancelled");
          return;
        }
        const resultImageId = await this.deps.persistResult(job, result);
        this.finish({ ...job, resultImageId }, "completed");
        return;
      } catch (err) {
        timeout.clear();
        if (controller.signal.aborted) {
          this.finish(job, "cancelled");
          return;
        }
        const error: GenerationError = timeout.timedOut()
          ? { code: "TIMEOUT", message: "The provider took too long to answer.", retryable: true }
          : toGenerationError(err);

        const canRetry = error.retryable && job.attempt < this.config.maxAttempts;
        if (!canRetry) {
          this.finish({ ...job, error }, "failed");
          return;
        }
        const backoff = computeBackoffMs(job.attempt, {
          baseMs: this.config.backoffBaseMs ?? 1500,
          maxMs: this.config.backoffMaxMs ?? 30_000,
          ...(this.config.random ? { random: this.config.random } : {}),
        });
        const waitMs = Math.max(backoff, error.retryAfterMs ?? 0);
        job = { ...job, error, nextRetryAt: new Date(Date.now() + waitMs).toISOString() };
        this.update(job);
        try {
          await doSleep(waitMs, controller.signal);
        } catch {
          this.finish(job, "cancelled");
          return;
        }
      }
    }
  }

  private finish(job: GenerationJob, status: "completed" | "failed" | "cancelled"): void {
    const done: GenerationJob = { ...job, status, completedAt: nowIso() };
    delete done.nextRetryAt;
    if (status !== "failed") delete done.error;
    if (status === "cancelled") {
      done.error = { code: "CANCELLED", message: "Cancelled.", retryable: false };
    }
    this.update(done);
  }

  private update(job: GenerationJob): void {
    this.jobs.set(job.id, job);
    this.emit(job);
  }

  private emit(job: GenerationJob): void {
    this.deps.onJobUpdate({ ...job });
  }
}
