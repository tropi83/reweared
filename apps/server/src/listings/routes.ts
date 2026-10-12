import type { FastifyBaseLogger, FastifyInstance, onRequestAsyncHookHandler } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { idParams } from "@aiv/contracts/common";
import { createListingBody, listingDocumentDto, listingSummaryDto, patchListingBody } from "@aiv/contracts/listing";
import type { Db } from "../db/client";
import { sessionUser } from "../http/auth-guard";
import { HttpError } from "../http/errors";
import type { ObjectStore } from "../storage/object-store";
import { listingPrefix } from "../storage/keys";
import { createListing, deleteListing, getDocument, listSummaries, patchListing } from "./repository";

export interface ListingRouteDeps {
  db: Db;
  store: ObjectStore;
  guard: onRequestAsyncHookHandler;
  log: FastifyBaseLogger;
}

export function registerListingRoutes(app: FastifyInstance, { db, store, guard, log }: ListingRouteDeps): void {
  const api = app.withTypeProvider<ZodTypeProvider>();

  api.get("/api/v1/listings", { onRequest: guard, schema: { response: { 200: z.array(listingSummaryDto) } } }, async (req) =>
    listSummaries(db, sessionUser(req).id),
  );

  api.post("/api/v1/listings", { onRequest: guard, schema: { body: createListingBody, response: { 201: listingDocumentDto } } }, async (req, reply) => {
    const doc = await createListing(db, sessionUser(req).id, req.body.name);
    return reply.code(201).send(doc);
  });

  api.get("/api/v1/listings/:id", { onRequest: guard, schema: { params: idParams, response: { 200: listingDocumentDto } } }, async (req) =>
    getDocument(db, sessionUser(req).id, req.params.id),
  );

  api.patch(
    "/api/v1/listings/:id",
    { onRequest: guard, schema: { params: idParams, body: patchListingBody, response: { 200: listingDocumentDto } } },
    async (req) => patchListing(db, sessionUser(req).id, req.params.id, req.body),
  );

  api.delete("/api/v1/listings/:id", { onRequest: guard, schema: { params: idParams } }, async (req, reply) => {
    const userId = sessionUser(req).id;
    if (!(await deleteListing(db, userId, req.params.id))) throw new HttpError(404, "NOT_FOUND", "Listing not found.");
    // Rows are gone (images cascade); objects left behind by a store failure are unreachable and swept later.
    await store.deletePrefix(listingPrefix(userId, req.params.id)).catch((error: unknown) => {
      log.error({ err: error, userId, listingId: req.params.id }, "listing objects not deleted; left for the orphan sweep");
    });
    return reply.code(204).send();
  });
}
