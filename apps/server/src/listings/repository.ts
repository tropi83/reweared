import { and, desc, eq, inArray } from "drizzle-orm";
import { createId } from "@aiv/domain/lib/ids";
import type { ListingDocument, ListingSummary } from "@aiv/domain/models";
import type { z } from "zod";
import type { patchListingBody } from "@aiv/contracts/listing";
import type { Db } from "../db/client";
import { generation, generationJob, imageAsset, listing } from "../db/schema";
import { HttpError } from "../http/errors";
import { toDocument, toSummary } from "./to-dto";

type ListingPatch = z.infer<typeof patchListingBody>;

const notFound = () => new HttpError(404, "NOT_FOUND", "Listing not found.");

/**
 * Listings of one user. Every function takes the session user's id first and puts it in every `where`:
 * another user's listing is indistinguishable from a missing one (404).
 */
export async function listSummaries(db: Db, userId: string): Promise<ListingSummary[]> {
  const rows = await db.select().from(listing).where(eq(listing.userId, userId)).orderBy(desc(listing.updatedAt));
  if (rows.length === 0) return [];
  const images = await db
    .select()
    .from(imageAsset)
    .where(
      and(
        eq(imageAsset.userId, userId),
        inArray(
          imageAsset.listingId,
          rows.map((r) => r.id),
        ),
      ),
    );
  return rows.map((r) =>
    toSummary(
      r,
      images.filter((i) => i.listingId === r.id),
    ),
  );
}

export async function getDocument(db: Db, userId: string, listingId: string): Promise<ListingDocument> {
  const [row] = await db
    .select()
    .from(listing)
    .where(and(eq(listing.id, listingId), eq(listing.userId, userId)));
  if (!row) throw notFound();
  const [images, generations, jobs] = await Promise.all([
    db
      .select()
      .from(imageAsset)
      .where(and(eq(imageAsset.listingId, listingId), eq(imageAsset.userId, userId))),
    db
      .select()
      .from(generation)
      .where(and(eq(generation.listingId, listingId), eq(generation.userId, userId))),
    db
      .select()
      .from(generationJob)
      .where(and(eq(generationJob.listingId, listingId), eq(generationJob.userId, userId))),
  ]);
  return toDocument(row, images, generations, jobs);
}

export async function createListing(db: Db, userId: string, name: string | undefined): Promise<ListingDocument> {
  const [row] = await db
    .insert(listing)
    .values({ id: createId("lst"), userId, name: name ?? "Untitled" })
    .returning();
  if (!row) throw new Error("listing insert returned nothing");
  return toDocument(row, []);
}

/** Applies a validated patch; image references must point to images of this listing. */
export async function patchListing(db: Db, userId: string, listingId: string, patch: ListingPatch): Promise<ListingDocument> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(listing)
      .where(and(eq(listing.id, listingId), eq(listing.userId, userId)))
      .for("update");
    if (!current) throw notFound();

    const referenced = [...(patch.coverImageId ? [patch.coverImageId] : []), ...(patch.toPost ?? [])];
    if (referenced.length > 0) {
      const owned = await tx
        .select({ id: imageAsset.id })
        .from(imageAsset)
        .where(and(eq(imageAsset.listingId, listingId), eq(imageAsset.userId, userId), inArray(imageAsset.id, referenced)));
      const ownedIds = new Set(owned.map((o) => o.id));
      if (referenced.some((id) => !ownedIds.has(id))) throw new HttpError(400, "VALIDATION_FAILED", "An image does not belong to this listing.");
    }

    const [row] = await tx
      .update(listing)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(patch.brand !== undefined ? { brand: patch.brand } : {}),
        ...(patch.useMannequin !== undefined ? { useMannequin: patch.useMannequin } : {}),
        ...(patch.copy !== undefined ? { copy: patch.copy } : {}),
        ...(patch.coverImageId !== undefined ? { coverImageId: patch.coverImageId } : {}),
        ...(patch.toPost !== undefined ? { toPost: [...new Set(patch.toPost)] } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(listing.id, listingId), eq(listing.userId, userId)))
      .returning();
    if (!row) throw notFound();
    const images = await tx
      .select()
      .from(imageAsset)
      .where(and(eq(imageAsset.listingId, listingId), eq(imageAsset.userId, userId)));
    return toDocument(row, images);
  });
}

/** Deletes the rows (images cascade); the caller removes the objects. Returns false when there was nothing to delete. */
export async function deleteListing(db: Db, userId: string, listingId: string): Promise<boolean> {
  const removed = await db
    .delete(listing)
    .where(and(eq(listing.id, listingId), eq(listing.userId, userId)))
    .returning({ id: listing.id });
  return removed.length > 0;
}
