import type { FastifyBaseLogger, FastifyInstance, onRequestAsyncHookHandler } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { createId } from "@aiv/domain/lib/ids";
import { idParams } from "@aiv/contracts/common";
import { imageAssetDto } from "@aiv/contracts/listing";
import type { Db } from "../db/client";
import { imageAsset, listing } from "../db/schema";
import { sessionUser } from "../http/auth-guard";
import { HttpError } from "../http/errors";
import { toImageAsset } from "../listings/to-dto";
import { objectKey } from "../storage/keys";
import type { ObjectStore } from "../storage/object-store";
import { processUpload, safeFileName } from "./process-upload";

export interface ImageRouteDeps {
  db: Db;
  store: ObjectStore;
  guard: onRequestAsyncHookHandler;
  log: FastifyBaseLogger;
  maxUploadBytes: number;
}

const notFound = (what: string) => new HttpError(404, "NOT_FOUND", `${what} not found.`);

/** Images are immutable: an asset id never points to other bytes, so clients may cache them for good. */
const IMMUTABLE_CACHE = "private, max-age=31536000, immutable";

export function registerImageRoutes(app: FastifyInstance, { db, store, guard, log, maxUploadBytes }: ImageRouteDeps): void {
  const api = app.withTypeProvider<ZodTypeProvider>();

  /**
   * Upload of a listing's original photo (multipart, one file). Generated images are written by the worker
   * (phase 2). The session is checked before the body is read, and the listing before the file is processed.
   */
  api.post(
    "/api/v1/listings/:id/images",
    {
      onRequest: guard,
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: { params: idParams, response: { 201: imageAssetDto } },
    },
    async (req, reply) => {
      const userId = sessionUser(req).id;
      const listingId = req.params.id;
      const [owned] = await db
        .select({ id: listing.id })
        .from(listing)
        .where(and(eq(listing.id, listingId), eq(listing.userId, userId)));
      if (!owned) throw notFound("Listing");

      const file = await req.file({ limits: { fileSize: maxUploadBytes, files: 1, fields: 0, parts: 1 } });
      if (!file) throw new HttpError(400, "VALIDATION_FAILED", "No image was sent.");
      const bytes = await file.toBuffer();
      const processed = await processUpload(bytes, { maxBytes: maxUploadBytes });

      const assetId = createId("img");
      const key = objectKey(userId, listingId, "original", assetId, processed.original.extension);
      const thumbKey = objectKey(userId, listingId, "thumbnail", assetId, "webp");
      await store.put(key, processed.original.bytes, processed.original.mimeType);
      await store.put(thumbKey, processed.thumbnail.bytes, "image/webp");

      try {
        const row = await db.transaction(async (tx) => {
          const [current] = await tx
            .select({ originalImageId: listing.originalImageId })
            .from(listing)
            .where(and(eq(listing.id, listingId), eq(listing.userId, userId)))
            .for("update");
          if (!current) throw notFound("Listing");
          const fileName = safeFileName(file.filename);
          const [inserted] = await tx
            .insert(imageAsset)
            .values({
              id: assetId,
              listingId,
              userId,
              kind: "original",
              mimeType: processed.original.mimeType,
              width: processed.original.width,
              height: processed.original.height,
              byteSize: processed.original.bytes.length,
              ...(fileName ? { fileName } : {}),
              objectKey: key,
              thumbKey,
              sha256: processed.sha256,
            })
            .returning();
          await tx
            .update(listing)
            .set({ ...(current.originalImageId ? {} : { originalImageId: assetId }), updatedAt: new Date() })
            .where(eq(listing.id, listingId));
          return inserted;
        });
        if (!row) throw new Error("image insert returned nothing");
        return reply.code(201).send(toImageAsset(row));
      } catch (error) {
        // The row was not written: remove the bytes so nothing unreachable stays behind.
        await Promise.allSettled([store.delete(key), store.delete(thumbKey)]);
        throw error;
      }
    },
  );

  /** Bytes of one image (`variant=thumb` for the 512 px WebP), streamed from the private bucket. */
  api.get(
    "/api/v1/images/:id",
    { onRequest: guard, schema: { params: idParams, querystring: z.strictObject({ variant: z.enum(["full", "thumb"]).default("full") }) } },
    async (req, reply) => {
      const [row] = await db
        .select()
        .from(imageAsset)
        .where(and(eq(imageAsset.id, req.params.id), eq(imageAsset.userId, sessionUser(req).id)));
      if (!row) throw notFound("Image");
      const thumb = req.query.variant === "thumb";
      const etag = `"${row.sha256}${thumb ? "-t" : ""}"`;
      reply.header("cache-control", IMMUTABLE_CACHE).header("etag", etag).header("x-content-type-options", "nosniff").header("content-disposition", "inline");
      if (req.headers["if-none-match"] === etag) return reply.code(304).send();
      const object = await store.get(thumb ? row.thumbKey : row.objectKey);
      if (!object) {
        log.error({ imageId: row.id }, "image row without stored bytes");
        throw notFound("Image");
      }
      return reply
        .type(thumb ? "image/webp" : row.mimeType)
        .header("content-length", object.contentLength)
        .send(object.body);
    },
  );

  /** Removes an image and every reference the listing kept to it (original, cover, photos to post). */
  api.delete("/api/v1/images/:id", { onRequest: guard, schema: { params: idParams } }, async (req, reply) => {
    const userId = sessionUser(req).id;
    const removed = await db.transaction(async (tx) => {
      const [row] = await tx
        .delete(imageAsset)
        .where(and(eq(imageAsset.id, req.params.id), eq(imageAsset.userId, userId)))
        .returning();
      if (!row) return undefined;
      const [owner] = await tx.select().from(listing).where(eq(listing.id, row.listingId)).for("update");
      if (owner) {
        await tx
          .update(listing)
          .set({
            ...(owner.originalImageId === row.id ? { originalImageId: null } : {}),
            ...(owner.coverImageId === row.id ? { coverImageId: null } : {}),
            toPost: owner.toPost.filter((id) => id !== row.id),
            updatedAt: new Date(),
          })
          .where(eq(listing.id, owner.id));
      }
      return row;
    });
    if (!removed) throw notFound("Image");
    await Promise.all([store.delete(removed.objectKey), store.delete(removed.thumbKey)]).catch((error: unknown) => {
      log.error({ err: error, imageId: removed.id }, "image objects not deleted; left for the orphan sweep");
    });
    return reply.code(204).send();
  });
}
