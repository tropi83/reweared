import { and, asc, eq, inArray } from "drizzle-orm";
import type { Redis } from "ioredis";
import { deriveGenerationStatus, type AspectRatio, type ModelInfo } from "@aiv/domain/models";
import { createId } from "@aiv/domain/lib/ids";
import { jobCost, runCost } from "@aiv/domain/services/credits";
import type { Db } from "../db/client";
import { generation, generationJob, imageAsset, listing, userSettings } from "../db/schema";
import { ensureMonthlyGrant, refund, reserve, type Tx } from "../credits/ledger";
import { HttpError } from "../http/errors";
import type { Dispatcher } from "../queue/dispatcher";
import type { NeuronBudget } from "../queue/budget";
import type { QueueSet } from "../queue/queues";
import { estimatedNeurons, type CopyProviderId, type ImageProviderId } from "../providers/catalogue";
import { planImageJobs, randomJobSeed } from "./plan";

export interface Platform {
  imageProvider: ImageProviderId;
  imageModel: ModelInfo;
  copyProvider: CopyProviderId;
  copyModelId: string;
}

export interface RunDeps {
  db: Db;
  redis: Redis;
  queues: QueueSet;
  dispatcher: Dispatcher;
  budget: NeuronBudget;
  platform: Platform;
  freeMonthlyCredits: number;
}

export interface StartedRun {
  generationId: string;
  kind: "images" | "copy";
  jobIds: string[];
  credits: number;
}

const notFound = (what: string) => new HttpError(404, "NOT_FOUND", `${what} not found.`);

/** Key the worker polls while a job runs; set by a cancel request. */
export const cancelKey = (jobId: string) => `cancel:${jobId}`;

/**
 * Starts a listing's photo pack: listing and source checked under lock, generation + one job per shot inserted
 * `queued`, credits reserved — all in one transaction (402 writes nothing). Then the dispatcher feeds BullMQ.
 */
export async function startImageRun(
  deps: RunDeps,
  userId: string,
  listingId: string,
  body: {
    sourceImageId?: string | undefined;
    shotIds?: string[] | undefined;
    aspectRatio?: AspectRatio | undefined;
    options?: Record<string, string | number | boolean> | undefined;
  },
): Promise<StartedRun> {
  const { db, platform } = deps;
  const run = await db.transaction(async (tx) => {
    const [owned] = await tx
      .select()
      .from(listing)
      .where(and(eq(listing.id, listingId), eq(listing.userId, userId)))
      .for("update");
    if (!owned) throw notFound("Listing");
    const sourceImageId = body.sourceImageId ?? owned.originalImageId;
    if (!sourceImageId) throw new HttpError(400, "VALIDATION_FAILED", "Add a photo of the item first.");
    const [source] = await tx
      .select({ id: imageAsset.id })
      .from(imageAsset)
      .where(and(eq(imageAsset.id, sourceImageId), eq(imageAsset.listingId, listingId), eq(imageAsset.userId, userId)));
    if (!source) throw notFound("Image");
    const [settings] = await tx.select().from(userSettings).where(eq(userSettings.userId, userId));
    const plans = planImageJobs({
      category: owned.category,
      useMannequin: owned.useMannequin,
      mannequin: settings?.settings.mannequin,
      model: platform.imageModel,
      shotIds: body.shotIds,
      aspectRatio: body.aspectRatio,
      options: body.options,
    });
    const estimate = estimatedNeurons(platform.imageProvider, platform.imageModel.id) * plans.length;
    if (!(await deps.budget.allows(estimate)))
      throw new HttpError(503, "PROVIDER_BUDGET_EXHAUSTED", "Image generation has reached today's limit. Try again tomorrow.");

    const generationId = createId("gen");
    const credits = runCost("image", plans.length);
    await tx.insert(generation).values({
      id: generationId,
      listingId,
      userId,
      kind: "images",
      sourceImageId,
      category: owned.category,
      settings: {
        providerId: platform.imageProvider,
        modelId: platform.imageModel.id,
        aspectRatio: body.aspectRatio ?? "original",
        ...(body.options ? { providerOptions: body.options } : {}),
        variationCount: plans.length,
      },
    });
    const jobIds = plans.map(() => createId("job"));
    await tx.insert(generationJob).values(
      plans.map((p, i) => ({
        id: jobIds[i]!,
        generationId,
        listingId,
        userId,
        kind: "images" as const,
        index: p.index,
        sourceImageId,
        prompt: p.prompt,
        shotId: p.shotId,
        shotLabel: p.shotLabel,
        provider: platform.imageProvider,
        model: platform.imageModel.id,
        aspectRatio: p.aspectRatio,
        ...(p.providerOptions ? { providerOptions: p.providerOptions } : {}),
        seed: p.seed,
        credits: jobCost("image"),
      })),
    );
    await ensureMonthlyGrant(tx, userId, deps.freeMonthlyCredits);
    await reserve(tx, userId, credits, { generationId });
    return { generationId, kind: "images" as const, jobIds, credits };
  });
  await deps.dispatcher.offer(userId);
  return run;
}

/** Starts the title + description of a listing from its original photo (one copy job). */
export async function startCopyRun(deps: RunDeps, userId: string, listingId: string, language: "en" | "fr"): Promise<StartedRun> {
  const { db, platform } = deps;
  const run = await db.transaction(async (tx) => {
    const [owned] = await tx
      .select()
      .from(listing)
      .where(and(eq(listing.id, listingId), eq(listing.userId, userId)))
      .for("update");
    if (!owned) throw notFound("Listing");
    if (!owned.originalImageId) throw new HttpError(400, "VALIDATION_FAILED", "Add a photo of the item first.");
    const generationId = createId("gen");
    const jobId = createId("job");
    const credits = jobCost("copy");
    await tx.insert(generation).values({
      id: generationId,
      listingId,
      userId,
      kind: "copy",
      sourceImageId: owned.originalImageId,
      category: owned.category,
      settings: { providerId: platform.copyProvider, modelId: platform.copyModelId, aspectRatio: "original", variationCount: 1 },
    });
    await tx.insert(generationJob).values({
      id: jobId,
      generationId,
      listingId,
      userId,
      kind: "copy",
      index: 0,
      sourceImageId: owned.originalImageId,
      prompt: "",
      provider: platform.copyProvider,
      model: platform.copyModelId,
      providerOptions: { language },
      credits,
    });
    await ensureMonthlyGrant(tx, userId, deps.freeMonthlyCredits);
    await reserve(tx, userId, credits, { generationId });
    return { generationId, kind: "copy" as const, jobIds: [jobId], credits };
  });
  await deps.dispatcher.offer(userId);
  return run;
}

/**
 * Cancels a job. Not yet running: cancelled at once, removed from BullMQ, refunded. Running: the worker is told
 * through `cancel:<jobId>`; it aborts, persists nothing and refunds. Already finished: 409.
 */
export async function cancelJob(deps: RunDeps, userId: string, jobId: string): Promise<"cancelled" | "cancelling"> {
  const { db } = deps;
  const [job] = await db
    .select()
    .from(generationJob)
    .where(and(eq(generationJob.id, jobId), eq(generationJob.userId, userId)));
  if (!job) throw notFound("Job");
  if (job.status === "active") {
    await deps.redis.set(cancelKey(jobId), "1", "EX", 3600);
    return "cancelling";
  }
  if (job.status !== "queued" && job.status !== "dispatched") throw new HttpError(409, "CONFLICT", "This job has already finished.");
  const cancelled = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(generationJob)
      .set({ status: "cancelled", completedAt: new Date() })
      .where(and(eq(generationJob.id, jobId), inArray(generationJob.status, ["queued", "dispatched"])))
      .returning();
    if (!row) return false;
    await refund(tx, { userId, jobId, credits: row.credits, generationId: row.generationId });
    await refreshGenerationStatus(tx, row.generationId);
    return true;
  });
  // The job may have started in between: then the worker owns it.
  if (!cancelled) {
    await deps.redis.set(cancelKey(jobId), "1", "EX", 3600);
    return "cancelling";
  }
  await deps.queues
    .get(job.kind, job.provider)
    .remove(jobId)
    .catch(() => 0);
  await deps.dispatcher.offer(userId);
  return "cancelled";
}

/** Runs a failed photo job again: a new job in the same generation, a new seed, new credits reserved. */
export async function retryJob(deps: RunDeps, userId: string, jobId: string): Promise<StartedRun> {
  const run = await deps.db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(generationJob)
      .where(and(eq(generationJob.id, jobId), eq(generationJob.userId, userId)));
    if (!job) throw notFound("Job");
    if (job.status !== "failed" && job.status !== "cancelled") throw new HttpError(409, "CONFLICT", "Only a failed or cancelled job can be run again.");
    const newId = createId("job");
    await tx.insert(generationJob).values({
      id: newId,
      generationId: job.generationId,
      listingId: job.listingId,
      userId,
      kind: job.kind,
      index: job.index,
      sourceImageId: job.sourceImageId,
      prompt: job.prompt,
      shotId: job.shotId,
      shotLabel: job.shotLabel,
      provider: job.provider,
      model: job.model,
      aspectRatio: job.aspectRatio,
      imageSize: job.imageSize,
      providerOptions: job.providerOptions,
      seed: job.kind === "images" ? randomJobSeed() : null,
      credits: job.credits,
    });
    await tx.update(generation).set({ status: "active", completedAt: null }).where(eq(generation.id, job.generationId));
    await ensureMonthlyGrant(tx, userId, deps.freeMonthlyCredits);
    await reserve(tx, userId, job.credits, { generationId: job.generationId, retryJobId: newId });
    return { generationId: job.generationId, kind: job.kind, jobIds: [newId], credits: job.credits };
  });
  await deps.dispatcher.offer(userId);
  return run;
}

/** Recomputes a generation's status from its jobs (the domain's rule); sets completedAt when it is final. */
export async function refreshGenerationStatus(tx: Tx, generationId: string): Promise<void> {
  // Two jobs of a generation can end at the same moment: lock the generation first, so the second transaction
  // waits and then reads the first one's committed job status (READ COMMITTED) instead of a stale snapshot.
  await tx.select({ id: generation.id }).from(generation).where(eq(generation.id, generationId)).for("update");
  const jobs = await tx
    .select({ status: generationJob.status })
    .from(generationJob)
    .where(eq(generationJob.generationId, generationId))
    .orderBy(asc(generationJob.index));
  const status = deriveGenerationStatus(jobs.map((j) => ({ status: toDomainJobStatus(j.status) })));
  await tx
    .update(generation)
    .set({ status, ...(status === "active" ? { completedAt: null } : { completedAt: new Date() }) })
    .where(eq(generation.id, generationId));
}

export function toDomainJobStatus(status: string): "queued" | "generating" | "completed" | "failed" | "cancelled" {
  if (status === "dispatched") return "queued";
  if (status === "active") return "generating";
  return status as "queued" | "completed" | "failed" | "cancelled";
}
