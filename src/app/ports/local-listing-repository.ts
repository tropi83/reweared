import { AppError, CURRENT_SCHEMA_VERSION, type ImageAsset, type ImageMimeType, type ListingDocument } from "@aiv/domain/models";
import { createId, nowIso } from "@aiv/domain/lib/ids";
import { createThumbnail, decodeImage } from "@/infrastructure/image/image-processing";
import type { StorageProvider } from "@/infrastructure/storage";
import { primeImageUrl } from "../image-urls";
import type { ListingRepository } from "./listing-repository";

/** Listings on this device: IndexedDB on the web, files in the Tauri apps. */
export class LocalListingRepository implements ListingRepository {
  constructor(
    private readonly storage: StorageProvider,
    private readonly appVersion: string,
  ) {}

  list() {
    return this.storage.listListings();
  }

  async get(listingId: string) {
    const doc = await this.storage.getListing(listingId);
    if (doc) {
      // Jobs interrupted by a previous app close must never look alive.
      for (const job of Object.values(doc.jobs)) {
        if (job.status === "queued" || job.status === "generating") {
          job.status = "failed";
          job.error = { code: "CANCELLED", message: "Interrupted when the app closed.", retryable: false };
          job.completedAt = nowIso();
        }
      }
    }
    return doc;
  }

  async create(name: string, original: { blob: Blob; mimeType: ImageMimeType; fileName?: string }) {
    const listingId = createId("lst");
    const asset = await this.storeImage(listingId, "original", original.blob, original.mimeType, original.fileName ? { fileName: original.fileName } : {});
    const now = nowIso();
    const doc: ListingDocument = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      appVersion: this.appVersion,
      listing: { id: listingId, name, originalImageId: asset.id, coverImageId: asset.id, createdAt: now, updatedAt: now },
      images: { [asset.id]: asset },
      generations: {},
      jobs: {},
      toPost: [],
    };
    await this.storage.saveListing(doc);
    return doc;
  }

  save(doc: ListingDocument) {
    return this.storage.saveListing(doc);
  }

  delete(listingId: string) {
    return this.storage.deleteListing(listingId);
  }

  async duplicate(listingId: string, name: string) {
    const source = await this.storage.getListing(listingId);
    if (!source) return null;
    const newId = createId("lst");
    const now = nowIso();
    const doc: ListingDocument = structuredClone(source);
    doc.listing = { ...doc.listing, id: newId, name, createdAt: now, updatedAt: now };
    for (const image of Object.values(doc.images)) image.listingId = newId;
    for (const gen of Object.values(doc.generations)) gen.listingId = newId;
    for (const job of Object.values(doc.jobs)) job.listingId = newId;
    for (const image of Object.values(source.images)) {
      for (const bucket of [image.kind, "thumbnail"] as const) {
        const blob = await this.storage.readImage(listingId, bucket, image.id);
        if (blob) await this.storage.writeImage(newId, bucket, image.id, blob);
      }
    }
    await this.storage.saveListing(doc);
    return doc;
  }

  readImage(listingId: string, bucket: "original" | "generation" | "thumbnail", assetId: string) {
    return this.storage.readImage(listingId, bucket, assetId);
  }

  async deleteImage(listingId: string, asset: Pick<ImageAsset, "id" | "kind">) {
    await this.storage.deleteImage(listingId, asset.kind, asset.id);
    await this.storage.deleteImage(listingId, "thumbnail", asset.id).catch(() => undefined);
  }

  storeGeneratedImage(listingId: string, blob: Blob, mimeType: ImageMimeType, extra: Pick<ImageAsset, "generationId" | "jobId">) {
    return this.storeImage(listingId, "generation", blob, mimeType, extra);
  }

  private async storeImage(listingId: string, kind: ImageAsset["kind"], blob: Blob, mimeType: ImageMimeType, extra: Partial<ImageAsset>) {
    const decoded = await decodeImage(blob);
    let thumbnail: Blob;
    try {
      thumbnail = await createThumbnail(decoded.bitmap);
    } finally {
      decoded.bitmap.close();
    }
    const asset: ImageAsset = {
      id: createId("img"),
      listingId,
      kind,
      mimeType,
      width: decoded.width,
      height: decoded.height,
      byteSize: blob.size,
      createdAt: nowIso(),
      ...extra,
    };
    try {
      await this.storage.writeImage(listingId, kind, asset.id, blob);
      await this.storage.writeImage(listingId, "thumbnail", asset.id, thumbnail);
    } catch (err) {
      await this.storage.deleteImage(listingId, kind, asset.id).catch(() => undefined);
      await this.storage.deleteImage(listingId, "thumbnail", asset.id).catch(() => undefined);
      throw new AppError("STORAGE_ERROR", "The image could not be saved on this device.", { cause: err });
    }
    primeImageUrl(listingId, kind, asset.id, blob);
    primeImageUrl(listingId, "thumbnail", asset.id, thumbnail);
    return asset;
  }
}
