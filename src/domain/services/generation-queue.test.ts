import { describe, expect, it, vi } from "vitest";
import { AppError, type GenerationJob, type JobStatus } from "@/domain/models";
import { GenerationQueue, type QueueDependencies } from "./generation-queue";
import type { ImageGenerationResult, ImageProvider } from "./image-provider";

function makeJob(index: number, overrides: Partial<GenerationJob> = {}): GenerationJob {
  return {
    id: `job_${index}`,
    projectId: "prj_1",
    generationId: "gen_1",
    sourceImageId: "img_src",
    index,
    prompt: "test",
    provider: "mock",
    model: "mock-model",
    aspectRatio: "original",
    status: "queued",
    attempt: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const okResult: ImageGenerationResult = { image: new Blob(["x"], { type: "image/png" }), mimeType: "image/png" };

interface Harness {
  queue: GenerationQueue;
  updates: GenerationJob[];
  generate: ReturnType<typeof vi.fn>;
  waitForIdle(): Promise<void>;
  statuses(): Record<string, JobStatus>;
}

function harness(
  generateImpl: (job: GenerationJob, signal: AbortSignal) => Promise<ImageGenerationResult>,
  config: Partial<ConstructorParameters<typeof GenerationQueue>[1]> = {},
): Harness {
  const updates: GenerationJob[] = [];
  const jobsById = new Map<string, GenerationJob>();
  const generate = vi.fn(async (req: { prompt: string }, opts: { signal: AbortSignal }) => generateImpl(jobsById.get(req.prompt)!, opts.signal));
  const provider: ImageProvider = {
    info: { id: "mock", displayName: "Mock", credentialKinds: ["none"] },
    getModels: async () => [],
    getAuthStatus: async () => ({ state: "authenticated", kind: "none" }),
    validateCredentials: async () => ({ state: "authenticated", kind: "none" }),
    generate,
  };
  const deps: QueueDependencies = {
    getProvider: async () => provider,
    buildRequest: async (job) => {
      jobsById.set(job.id, job);
      // The harness routes requests back to their job through the prompt field.
      return { prompt: job.id, model: job.model };
    },
    persistResult: async (job) => `img_result_${job.id}`,
    onJobUpdate: (job) => updates.push(job),
  };
  const queue = new GenerationQueue(deps, {
    concurrency: 2,
    maxAttempts: 3,
    timeoutMs: 1000,
    sleep: async () => {},
    backoffBaseMs: 1,
    backoffMaxMs: 2,
    ...config,
  });
  const waitForIdle = async () => {
    for (let i = 0; i < 200 && queue.activeCount > 0; i++) {
      await new Promise((r) => setTimeout(r, 2));
    }
  };
  const statuses = () => {
    const out: Record<string, JobStatus> = {};
    for (const u of updates) out[u.id] = u.status;
    return out;
  };
  return { queue, updates, generate, waitForIdle, statuses };
}

describe("GenerationQueue", () => {
  it("runs jobs with bounded concurrency and completes each one independently", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const h = harness(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return okResult;
    });
    h.queue.enqueue([1, 2, 3, 4].map((i) => makeJob(i)));
    await h.waitForIdle();
    expect(maxInFlight).toBe(2);
    expect(h.statuses()).toEqual({ job_1: "completed", job_2: "completed", job_3: "completed", job_4: "completed" });
    const done = h.updates.filter((u) => u.status === "completed");
    expect(done.map((j) => j.resultImageId)).toEqual(["img_result_job_1", "img_result_job_2", "img_result_job_3", "img_result_job_4"]);
  });

  it("fails one job among four without affecting the others", async () => {
    const h = harness(async (job) => {
      if (job.index === 3) throw new AppError("CONTENT_REJECTED", "nope");
      return okResult;
    });
    h.queue.enqueue([1, 2, 3, 4].map((i) => makeJob(i)));
    await h.waitForIdle();
    expect(h.statuses()).toEqual({ job_1: "completed", job_2: "completed", job_3: "failed", job_4: "completed" });
    const failed = h.updates.find((u) => u.id === "job_3" && u.status === "failed");
    expect(failed?.error?.code).toBe("CONTENT_REJECTED");
    expect(failed?.attempt).toBe(1);
  });

  it("retries retryable errors (429) with backoff and eventually succeeds", async () => {
    let calls = 0;
    const h = harness(async () => {
      calls++;
      if (calls < 3) throw new AppError("RATE_LIMITED", "slow down", { retryAfterMs: 1 });
      return okResult;
    });
    h.queue.enqueue([makeJob(1)]);
    await h.waitForIdle();
    expect(calls).toBe(3);
    const final = h.updates.at(-1)!;
    expect(final.status).toBe("completed");
    expect(final.attempt).toBe(3);
    // A retry wait was surfaced to the UI
    expect(h.updates.some((u) => u.nextRetryAt && u.error?.code === "RATE_LIMITED")).toBe(true);
  });

  it("gives up after maxAttempts on persistent retryable errors", async () => {
    let calls = 0;
    const h = harness(async () => {
      calls++;
      throw new AppError("PROVIDER_UNAVAILABLE", "down");
    });
    h.queue.enqueue([makeJob(1)]);
    await h.waitForIdle();
    expect(calls).toBe(3);
    expect(h.updates.at(-1)?.status).toBe("failed");
    expect(h.updates.at(-1)?.error?.code).toBe("PROVIDER_UNAVAILABLE");
  });

  it("does not retry non-retryable errors", async () => {
    let calls = 0;
    const h = harness(async () => {
      calls++;
      throw new AppError("INVALID_CREDENTIAL", "bad key");
    });
    h.queue.enqueue([makeJob(1)]);
    await h.waitForIdle();
    expect(calls).toBe(1);
    expect(h.updates.at(-1)?.status).toBe("failed");
  });

  it("cancels a running job and never persists its result", async () => {
    const persist = vi.fn(async () => "img_x");
    const updates: GenerationJob[] = [];
    const provider: ImageProvider = {
      info: { id: "mock", displayName: "Mock", credentialKinds: ["none"] },
      getModels: async () => [],
      getAuthStatus: async () => ({ state: "authenticated", kind: "none" }),
      validateCredentials: async () => ({ state: "authenticated", kind: "none" }),
      generate: (_r, { signal }) =>
        new Promise((resolve, reject) => {
          const t = setTimeout(() => resolve(okResult), 50);
          signal.addEventListener("abort", () => {
            clearTimeout(t);
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          });
        }),
    };
    const queue = new GenerationQueue(
      {
        getProvider: async () => provider,
        buildRequest: async (job) => ({ prompt: job.prompt, model: job.model }),
        persistResult: persist,
        onJobUpdate: (j) => updates.push(j),
      },
      { concurrency: 1, maxAttempts: 3, timeoutMs: 1000 },
    );
    queue.enqueue([makeJob(1), makeJob(2)]);
    await new Promise((r) => setTimeout(r, 5));
    queue.cancelAll();
    for (let i = 0; i < 50 && queue.activeCount > 0; i++) await new Promise((r) => setTimeout(r, 2));
    expect(persist).not.toHaveBeenCalled();
    const byId: Record<string, JobStatus> = {};
    for (const u of updates) byId[u.id] = u.status;
    expect(byId).toEqual({ job_1: "cancelled", job_2: "cancelled" });
  });

  it("times out slow providers and marks the error as TIMEOUT", async () => {
    const h = harness(
      (_job, signal) =>
        new Promise((resolve, reject) => {
          const t = setTimeout(() => resolve(okResult), 500);
          signal.addEventListener("abort", () => {
            clearTimeout(t);
            reject(new Error("aborted"));
          });
        }),
      { timeoutMs: 10, maxAttempts: 1 },
    );
    h.queue.enqueue([makeJob(1)]);
    await h.waitForIdle();
    expect(h.updates.at(-1)?.status).toBe("failed");
    expect(h.updates.at(-1)?.error?.code).toBe("TIMEOUT");
  });

  it("can retry a failed job manually", async () => {
    let calls = 0;
    const h = harness(async () => {
      calls++;
      if (calls === 1) throw new AppError("CONTENT_REJECTED", "no");
      return okResult;
    });
    h.queue.enqueue([makeJob(1)]);
    await h.waitForIdle();
    expect(h.updates.at(-1)?.status).toBe("failed");
    h.queue.retry("job_1");
    await h.waitForIdle();
    expect(h.updates.at(-1)?.status).toBe("completed");
    expect(h.updates.at(-1)?.attempt).toBe(1);
  });

  it("re-queues with a patch, e.g. a fresh seed so a diffusion retry does not reproduce the same output", async () => {
    let calls = 0;
    const h = harness(async () => {
      calls++;
      if (calls === 1) throw new AppError("CONTENT_REJECTED", "no");
      return okResult;
    });
    h.queue.enqueue([{ ...makeJob(1), seed: 7 }]);
    await h.waitForIdle();
    expect(h.updates.at(-1)).toMatchObject({ status: "failed", seed: 7 });
    h.queue.retry("job_1", { seed: 99 });
    await h.waitForIdle();
    expect(h.updates.at(-1)).toMatchObject({ status: "completed", seed: 99, attempt: 1 });
  });

  it("surfaces provider resolution errors (e.g. AUTH_REQUIRED) as failed jobs", async () => {
    const updates: GenerationJob[] = [];
    const queue = new GenerationQueue(
      {
        getProvider: async () => {
          throw new AppError("AUTH_REQUIRED", "connect first");
        },
        buildRequest: async (job) => ({ prompt: job.prompt, model: job.model }),
        persistResult: async () => "x",
        onJobUpdate: (j) => updates.push(j),
      },
      { concurrency: 1, maxAttempts: 3, timeoutMs: 1000 },
    );
    queue.enqueue([makeJob(1)]);
    for (let i = 0; i < 50 && queue.activeCount > 0; i++) await new Promise((r) => setTimeout(r, 2));
    expect(updates.at(-1)?.status).toBe("failed");
    expect(updates.at(-1)?.error?.code).toBe("AUTH_REQUIRED");
  });
});
