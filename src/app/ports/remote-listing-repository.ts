import { z } from "zod";
import { AppError, type ImageAsset, type ImageMimeType, type Listing, type ListingDocument, type ListingSummary } from "@aiv/domain/models";
import { imageAssetDto, listingDocumentDto, listingSummaryDto, type patchListingBody } from "@aiv/contracts/listing";
import { ApiError, type ApiClient } from "@/infrastructure/api/ApiClient";
import { toAppError } from "@/infrastructure/api/to-app-error";
import type { ImageBucket } from "@/infrastructure/storage";
import type { ListingRepository, NewOriginal } from "./listing-repository";

type Patch = z.input<typeof patchListingBody>;

/** The fields of a listing the app edits; everything else in the document is the server's. */
const EDITABLE = ["name", "category", "brand", "useMannequin", "copy", "coverImageId"] as const;

interface Snapshot {
  listing: Pick<Listing, (typeof EDITABLE)[number]>;
  toPost: string[];
}

function snapshot(doc: ListingDocument): Snapshot {
  const listing: Snapshot["listing"] = { name: doc.listing.name };
  for (const key of EDITABLE) if (doc.listing[key] !== undefined) Object.assign(listing, { [key]: structuredClone(doc.listing[key]) });
  return { listing, toPost: [...doc.toPost] };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The PATCH body that brings `saved` to `doc`: changed fields only, `null` for a cleared optional field. */
export function listingPatch(saved: Snapshot | undefined, doc: ListingDocument): Patch {
  const next = snapshot(doc);
  const patch: Record<string, unknown> = {};
  for (const key of EDITABLE) {
    const before = saved?.listing[key];
    const after = next.listing[key];
    if (same(before, after)) continue;
    if (key === "name") {
      const name = String(after ?? "").trim();
      if (name) patch.name = name.slice(0, 120);
    } else {
      patch[key] = after ?? null;
    }
  }
  if (!same(saved?.toPost, next.toPost)) patch.toPost = next.toPost;
  return patch as Patch;
}

/**
 * Listings on the API: documents through `/api/v1/listings`, photos through `/api/v1/images`. Saves send only the
 * fields that changed since the last load or save of that listing.
 */
export class RemoteListingRepository implements ListingRepository {
  private readonly saved = new Map<string, Snapshot>();

  constructor(private readonly client: ApiClient) {}

  async list(): Promise<ListingSummary[]> {
    return this.call(() => this.client.get("/api/v1/listings", z.array(listingSummaryDto)));
  }

  async get(listingId: string): Promise<ListingDocument | null> {
    try {
      return this.remember(await this.client.get(`/api/v1/listings/${encodeURIComponent(listingId)}`, listingDocumentDto));
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw toAppError(error);
    }
  }

  async create(name: string, original: NewOriginal): Promise<ListingDocument> {
    const created = await this.call(() => this.client.request("POST", "/api/v1/listings", { json: { name: name.slice(0, 120) }, schema: listingDocumentDto }));
    const id = created.listing.id;
    try {
      await this.upload(id, original);
    } catch (error) {
      // No listing without its photo: remove the empty one so the sidebar does not keep it.
      await this.delete(id).catch(() => undefined);
      throw error;
    }
    const doc = await this.get(id);
    if (!doc) throw new AppError("STORAGE_ERROR", "The listing could not be created.");
    return doc;
  }

  async save(doc: ListingDocument): Promise<void> {
    const patch = listingPatch(this.saved.get(doc.listing.id), doc);
    if (Object.keys(patch).length === 0) return;
    await this.call(() => this.client.request("PATCH", `/api/v1/listings/${encodeURIComponent(doc.listing.id)}`, { json: patch, schema: listingDocumentDto }));
    // What was sent is now the server's state; edits made meanwhile go with the next save.
    this.saved.set(doc.listing.id, snapshot(doc));
  }

  async delete(listingId: string): Promise<void> {
    try {
      await this.client.request("DELETE", `/api/v1/listings/${encodeURIComponent(listingId)}`);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) throw toAppError(error);
    }
    this.saved.delete(listingId);
  }

  async duplicate(listingId: string, name: string): Promise<ListingDocument | null> {
    const source = await this.get(listingId);
    const original = source?.listing.originalImageId ? source.images[source.listing.originalImageId] : undefined;
    if (!source || !original) return null;
    const blob = await this.readImage(listingId, "original", original.id);
    if (!blob) return null;
    const copy = await this.create(name, { blob, mimeType: original.mimeType, ...(original.fileName ? { fileName: original.fileName } : {}) });
    // The photo pack is not copied (the server generates photos); the seller's choices are.
    const { category, brand, useMannequin } = source.listing;
    copy.listing = { ...copy.listing, ...(category ? { category } : {}), ...(brand ? { brand } : {}), ...(useMannequin ? { useMannequin } : {}) };
    if (source.listing.copy) copy.listing.copy = source.listing.copy;
    await this.save(copy);
    return copy;
  }

  async readImage(_listingId: string, bucket: ImageBucket, assetId: string): Promise<Blob | null> {
    try {
      const data = await this.client.get(`/api/v1/images/${encodeURIComponent(assetId)}?variant=${bucket === "thumbnail" ? "thumb" : "full"}`);
      // Duck-typed: the Blob class differs between runtimes (browser, Tauri, Node + jsdom in tests).
      return isBlob(data) ? data : null;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw toAppError(error);
    }
  }

  async deleteImage(_listingId: string, asset: Pick<ImageAsset, "id" | "kind">): Promise<void> {
    try {
      await this.client.request("DELETE", `/api/v1/images/${encodeURIComponent(asset.id)}`);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 404)) throw toAppError(error);
    }
  }

  private async upload(listingId: string, original: NewOriginal): Promise<void> {
    const form = new FormData();
    form.append("file", new File([original.blob], original.fileName ?? `original.${extension(original.mimeType)}`, { type: original.mimeType }));
    await this.call(() => this.client.request("POST", `/api/v1/listings/${encodeURIComponent(listingId)}/images`, { body: form, schema: imageAssetDto }));
  }

  private remember(doc: ListingDocument): ListingDocument {
    this.saved.set(doc.listing.id, snapshot(doc));
    return doc;
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw toAppError(error);
    }
  }
}

function isBlob(value: unknown): value is Blob {
  return typeof value === "object" && value !== null && typeof (value as Blob).arrayBuffer === "function" && typeof (value as Blob).size === "number";
}

function extension(mimeType: ImageMimeType): string {
  return mimeType === "image/jpeg" ? "jpg" : mimeType === "image/png" ? "png" : "webp";
}
