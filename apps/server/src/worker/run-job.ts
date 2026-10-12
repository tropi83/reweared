import sharp from "sharp";
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { Redis } from "ioredis";
import { AppError, toGenerationError, type GenerationError, type ListingCopy, type ModelInfo } from "@aiv/domain/models";
import { createId } from "@aiv/domain/lib/ids";
import { buildRequestForModel, seedForAttempt } from "@aiv/domain/services/image-provider";
import type { Db } from "../db/client";
import { generationJob, imageAsset, listing } from "../db/schema";
import { refund } from "../credits/ledger";
import { cancelKey, refreshGenerationStatus } from "../generations/runs";
import { processUpload } from "../images/process-upload";
import type { NeuronBudget } from "../queue/budget";
import type { Dispatcher } from "../queue/dispatcher";
import type { EventPublisher } from "../queue/events";
import { estimatedNeurons, type ImageProviderId } from "../providers/catalogue";
import { objectKey } from "../storage/keys";
import type { ObjectStore } from "../storage/object-store";
import type { Providers } from "./registry";
import { prepareSource } from "./prepare-source";

export interface RunJobDeps {
  db: Db;
  redis: Redis;
  store: ObjectStore;
  providers: Providers;
  imageProvider: ImageProviderId;
  imageModel: ModelInfo;
  copyModelId: string;
  attempts: number;
  timeoutMs: number;
  dispatcher: Dispatcher;
  budget: NeuronBudget;
  events: EventPublisher;
  log: FastifyBaseLogger;
}

/** What BullMQ tells us about the delivery. */
export interface Delivery {
  jobId: string;
  /** Attempts BullMQ already made before this one. */
  attemptsMade: number;
}

/** A retryable failure for BullMQ: it backs off (honouring `retryAfterMs`) and delivers the job again. */
export class RetryLater extends Error {
  constructor(readonly error: GenerationError) {
    super(error.message);
    this.name = "RetryLater";
  }
}

const CANCELLED = "cancelled";
const TIMED_OUT = "timeout";
/** The original photo sent to the copy model (same size as the app's). */
const COPY_IMAGE_MAX_DIMENSION = 1024;

type JobRow = typeof generationJob.$inferSelect;

/**
 * Runs one delivery of a job. Returns normally when the job reached a final state (completed, failed, cancelled)
 * or was not ours to run (already final, unknown); throws `RetryLater` for BullMQ to try again.
 */
export async function runJob(deps: RunJobDeps, delivery: Delivery): Promise<void> {
  const attempt = delivery.attemptsMade + 1;
  const [job] = await deps.db
    .update(generationJob)
    .set({ status: "active", attempt, startedAt: new Date() })
    .where(and(eq(generationJob.id, delivery.jobId), inArray(generationJob.status, ["dispatched", "active"])))
    .returning();
  // Cancelled, finished, or unknown: a late or duplicate delivery does nothing.
  if (!job) return;
  await publishJob(deps, job);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(TIMED_OUT), deps.timeoutMs);
  const watcher = setInterval(() => {
    void deps.redis.get(cancelKey(job.id)).then((v) => {
      if (v) controller.abort(CANCELLED);
    });
  }, 1000);
  try {
    if (await deps.redis.get(cancelKey(job.id))) controller.abort(CANCELLED);
    if (job.kind === "images") await runImage(deps, job, attempt, controller.signal);
    else await runCopy(deps, job, controller.signal);
  } catch (error) {
    if (controller.signal.reason === CANCELLED) return finishCancelled(deps, job);
    const failure = controller.signal.reason === TIMED_OUT ? new AppError("TIMEOUT", "The provider took too long.").toJSON() : toGenerationError(error);
    if (failure.code === "CANCELLED") return finishCancelled(deps, job);
    if (failure.retryable && attempt < deps.attempts) {
      await deps.db.update(generationJob).set({ error: failure }).where(eq(generationJob.id, job.id));
      throw new RetryLater(failure);
    }
    return finishFailed(deps, job, failure);
  } finally {
    clearTimeout(timeout);
    clearInterval(watcher);
  }
}

async function sourceBytes(deps: RunJobDeps, job: JobRow): Promise<Buffer> {
  if (!job.sourceImageId) throw new AppError("INVALID_REQUEST", "The job has no source image.", { retryable: false });
  const [asset] = await deps.db
    .select({ key: imageAsset.objectKey })
    .from(imageAsset)
    .where(and(eq(imageAsset.id, job.sourceImageId), eq(imageAsset.userId, job.userId)));
  const object = asset ? await deps.store.get(asset.key) : null;
  if (!object) throw new AppError("INVALID_IMAGE", "The source photo is gone.", { retryable: false });
  const chunks: Buffer[] = [];
  for await (const chunk of object.body) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function runImage(deps: RunJobDeps, job: JobRow, attempt: number, signal: AbortSignal): Promise<void> {
  const source = await prepareSource(await sourceBytes(deps, job), deps.imageModel, { aspectRatio: job.aspectRatio, imageSize: job.imageSize ?? undefined });
  const request = buildRequestForModel(deps.imageModel, {
    prompt: job.prompt,
    sourceImage: source,
    aspectRatio: job.aspectRatio,
    ...(job.imageSize ? { imageSize: job.imageSize } : {}),
    ...(job.seed !== null ? { seed: seedForAttempt(job.seed, attempt) } : {}),
    ...(job.providerOptions ? { options: job.providerOptions } : {}),
  });
  const result = await deps.providers.image.generate(request, { signal });
  if (signal.aborted || (await deps.redis.get(cancelKey(job.id)))) throw new AppError("CANCELLED", "Cancelled.");

  // Re-encoded like an upload: no metadata, a WebP thumbnail, the same storage layout.
  const processed = await processUpload(Buffer.from(await result.image.arrayBuffer()), { maxBytes: 64 * 1024 * 1024 });
  const assetId = createId("img");
  const key = objectKey(job.userId, job.listingId, "generation", assetId, processed.original.extension);
  const thumbKey = objectKey(job.userId, job.listingId, "thumbnail", assetId, "webp");
  await deps.store.put(key, processed.original.bytes, processed.original.mimeType);
  await deps.store.put(thumbKey, processed.thumbnail.bytes, "image/webp");
  const stored = await deps.db.transaction(async (tx) => {
    const [done] = await tx
      .update(generationJob)
      .set({ status: "completed", resultImageId: assetId, error: null, completedAt: new Date() })
      .where(and(eq(generationJob.id, job.id), eq(generationJob.status, "active")))
      .returning({ id: generationJob.id });
    // Cancelled meanwhile, or finished by another delivery: keep nothing.
    if (!done) return false;
    await tx.insert(imageAsset).values({
      id: assetId,
      listingId: job.listingId,
      userId: job.userId,
      kind: "generation",
      mimeType: processed.original.mimeType,
      width: processed.original.width,
      height: processed.original.height,
      byteSize: processed.original.bytes.length,
      objectKey: key,
      thumbKey,
      sha256: processed.sha256,
      generationId: job.generationId,
      jobId: job.id,
    });
    await refreshGenerationStatus(tx, job.generationId);
    return true;
  });
  if (!stored) {
    await Promise.allSettled([deps.store.delete(key), deps.store.delete(thumbKey)]);
    return;
  }
  await deps.budget.record(estimatedNeurons(deps.imageProvider, deps.imageModel.id)).catch(() => undefined);
  await afterFinal(deps, job.id);
}

async function runCopy(deps: RunJobDeps, job: JobRow, signal: AbortSignal): Promise<void> {
  const [owner] = await deps.db
    .select()
    .from(listing)
    .where(and(eq(listing.id, job.listingId), eq(listing.userId, job.userId)));
  if (!owner) throw new AppError("INVALID_REQUEST", "The listing is gone.", { retryable: false });
  const jpeg = await sharp(await sourceBytes(deps, job), { autoOrient: true })
    .resize({ width: COPY_IMAGE_MAX_DIMENSION, height: COPY_IMAGE_MAX_DIMENSION, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
  const language = job.providerOptions?.language === "fr" ? "fr" : "en";
  const brand = owner.brand?.trim();
  const result = await deps.providers.copy.describeListing(
    {
      image: { blob: new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), mimeType: "image/jpeg" },
      language,
      ...(owner.category ? { category: owner.category } : {}),
      ...(brand ? { brand } : {}),
    },
    { signal, model: deps.copyModelId },
  );
  if (signal.aborted || (await deps.redis.get(cancelKey(job.id)))) throw new AppError("CANCELLED", "Cancelled.");
  const copy: ListingCopy = {
    ...result.copy,
    ...(brand ? { brand } : {}),
    language,
    generatedAt: new Date().toISOString(),
    provider: job.provider,
    model: String(result.providerMeta?.model ?? deps.copyModelId),
  };
  const stored = await deps.db.transaction(async (tx) => {
    const [done] = await tx
      .update(generationJob)
      .set({ status: "completed", error: null, completedAt: new Date() })
      .where(and(eq(generationJob.id, job.id), eq(generationJob.status, "active")))
      .returning({ id: generationJob.id });
    if (!done) return false;
    // The listing is named after its generated title, as the apps do.
    const title = copy.title.trim();
    await tx
      .update(listing)
      .set({ copy, ...(title ? { name: title.slice(0, 120) } : {}), updatedAt: new Date() })
      .where(eq(listing.id, job.listingId));
    await refreshGenerationStatus(tx, job.generationId);
    return true;
  });
  if (!stored) return;
  await deps.events.publish(job.userId, { type: "listing", listingId: job.listingId }).catch(() => undefined);
  await afterFinal(deps, job.id);
}

async function finishCancelled(deps: RunJobDeps, job: JobRow): Promise<void> {
  const changed = await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .update(generationJob)
      .set({ status: "cancelled", completedAt: new Date() })
      .where(and(eq(generationJob.id, job.id), eq(generationJob.status, "active")))
      .returning();
    if (!row) return false;
    await refund(tx, { userId: row.userId, jobId: row.id, credits: row.credits, generationId: row.generationId });
    await refreshGenerationStatus(tx, row.generationId);
    return true;
  });
  await deps.redis.del(cancelKey(job.id));
  if (changed) await afterFinal(deps, job.id);
}

async function finishFailed(deps: RunJobDeps, job: JobRow, failure: GenerationError): Promise<void> {
  const changed = await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .update(generationJob)
      .set({ status: "failed", error: failure, completedAt: new Date() })
      .where(and(eq(generationJob.id, job.id), eq(generationJob.status, "active")))
      .returning();
    if (!row) return false;
    await refund(tx, { userId: row.userId, jobId: row.id, credits: row.credits, generationId: row.generationId });
    await refreshGenerationStatus(tx, row.generationId);
    return true;
  });
  if (changed) {
    deps.log.warn({ jobId: job.id, code: failure.code }, "job failed and was refunded");
    await afterFinal(deps, job.id);
  }
}

/** A job ended: tell the user, and give the freed slot to the user's next queued job. */
async function afterFinal(deps: RunJobDeps, jobId: string): Promise<void> {
  const [row] = await deps.db.select().from(generationJob).where(eq(generationJob.id, jobId));
  if (!row) return;
  await publishJob(deps, row);
  await deps.dispatcher.offer(row.userId);
}

async function publishJob(deps: RunJobDeps, row: JobRow): Promise<void> {
  await deps.events
    .publish(row.userId, {
      type: "job",
      jobId: row.id,
      generationId: row.generationId,
      listingId: row.listingId,
      status: row.status,
      attempt: row.attempt,
      ...(row.resultImageId ? { resultImageId: row.resultImageId } : {}),
      ...(row.error ? { error: { code: row.error.code, message: row.error.message } } : {}),
    })
    .catch((error: unknown) => deps.log.warn({ err: error, jobId: row.id }, "event not published"));
}
