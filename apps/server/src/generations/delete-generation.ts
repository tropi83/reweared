import { and, asc, eq } from "drizzle-orm";
import type { FastifyBaseLogger } from "fastify";
import type { Redis } from "ioredis";
import type { Db } from "../db/client";
import { generation, generationJob, imageAsset, listing } from "../db/schema";
import { refund } from "../credits/ledger";
import { HttpError } from "../http/errors";
import type { Dispatcher } from "../queue/dispatcher";
import type { EventPublisher } from "../queue/events";
import type { QueueSet } from "../queue/queues";
import type { ObjectStore } from "../storage/object-store";
import { cancelKey } from "./runs";

export interface DeleteGenerationDeps {
  db: Db;
  redis: Redis;
  queues: QueueSet;
  dispatcher: Dispatcher;
  store: ObjectStore;
  events: EventPublisher;
  log: FastifyBaseLogger;
}

const UNFINISHED = ["queued", "dispatched", "active"] as const;

/**
 * Deletes a listing's photo pack: its jobs, its generated images (rows, then bytes) and the references the listing
 * kept to them (cover, photos to post). Jobs that have not finished are refunded in the same transaction (key
 * `refund:<jobId>`, so a refund the worker may also attempt is a no-op) and their running attempt is told to stop;
 * a worker finishing later finds no `active` row and keeps nothing (it deletes the bytes it wrote).
 *
 * Locks follow the worker's order — the jobs, then the generation — so a job finishing at the same moment either
 * commits first (its image is then deleted here) or finds its row gone. Copy runs are not packs: 404.
 */
export async function deleteGeneration(deps: DeleteGenerationDeps, userId: string, generationId: string): Promise<void> {
  const removed = await deps.db.transaction(async (tx) => {
    await tx
      .select({ id: generationJob.id })
      .from(generationJob)
      .where(and(eq(generationJob.generationId, generationId), eq(generationJob.userId, userId)))
      .orderBy(asc(generationJob.id))
      .for("update");
    const [owned] = await tx
      .select()
      .from(generation)
      .where(and(eq(generation.id, generationId), eq(generation.userId, userId), eq(generation.kind, "images")))
      .for("update");
    if (!owned) return null;
    // Read again under the generation lock: a retry inserted meanwhile is visible now (a later one waits, then fails).
    const jobs = await tx.select().from(generationJob).where(eq(generationJob.generationId, generationId));
    const unfinished = jobs.filter((j) => (UNFINISHED as readonly string[]).includes(j.status));
    for (const job of unfinished) await refund(tx, { userId, jobId: job.id, credits: job.credits, generationId });

    const images = await tx
      .delete(imageAsset)
      .where(and(eq(imageAsset.generationId, generationId), eq(imageAsset.userId, userId), eq(imageAsset.kind, "generation")))
      .returning({ id: imageAsset.id, objectKey: imageAsset.objectKey, thumbKey: imageAsset.thumbKey });
    const imageIds = new Set(images.map((i) => i.id));
    const [owner] = await tx.select().from(listing).where(eq(listing.id, owned.listingId)).for("update");
    if (owner && imageIds.size > 0) {
      await tx
        .update(listing)
        .set({
          ...(owner.coverImageId && imageIds.has(owner.coverImageId) ? { coverImageId: null } : {}),
          toPost: owner.toPost.filter((id) => !imageIds.has(id)),
          updatedAt: new Date(),
        })
        .where(eq(listing.id, owner.id));
    }
    // Jobs go with the generation (foreign key cascade); the ledger keeps its rows (no foreign key to jobs).
    await tx.delete(generation).where(eq(generation.id, generationId));
    return { listingId: owned.listingId, unfinished, images };
  });
  if (!removed) throw new HttpError(404, "NOT_FOUND", "Photo pack not found.");

  for (const job of removed.unfinished) {
    if (job.status === "active") await deps.redis.set(cancelKey(job.id), "1", "EX", 3600);
    else
      await deps.queues
        .get(job.kind, job.provider)
        .remove(job.id)
        .catch(() => 0);
  }
  await Promise.all(removed.images.flatMap((i) => [deps.store.delete(i.objectKey), deps.store.delete(i.thumbKey)])).catch((error: unknown) => {
    deps.log.error({ err: error, generationId }, "pack objects not deleted; left for the orphan sweep");
  });
  // Freed slots go to the user's next queued job; the user's other devices re-read the listing.
  await deps.dispatcher.offer(userId);
  await deps.events.publish(userId, { type: "listing", listingId: removed.listingId }).catch(() => undefined);
}
