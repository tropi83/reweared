import type { AppSettings, ListingDocument, ListingSummary, Recipe } from "@/domain/models";

/** Which bytes bucket an image belongs to. Thumbnails share the asset id of their full image. */
export type ImageBucket = "original" | "generation" | "thumbnail";

export interface StorageUsage {
  listingCount: number;
  /** Approximate bytes used by image files. */
  imageBytes: number;
  /** Human-readable location, for the Settings page. */
  location: string;
}

/**
 * Persistence boundary. Metadata is JSON documents; image bytes are opaque blobs.
 *
 * Implementations: IndexedDbStorage (web), TauriFsStorage (desktop/mobile), MemoryStorage (tests).
 * Swapping to SQLite later means adding one more implementation, nothing in the domain changes.
 */
export interface StorageProvider {
  init(): Promise<void>;

  listListings(): Promise<ListingSummary[]>;
  getListing(listingId: string): Promise<ListingDocument | null>;
  saveListing(doc: ListingDocument): Promise<void>;
  deleteListing(listingId: string): Promise<void>;

  writeImage(listingId: string, bucket: ImageBucket, assetId: string, blob: Blob): Promise<void>;
  readImage(listingId: string, bucket: ImageBucket, assetId: string): Promise<Blob | null>;
  deleteImage(listingId: string, bucket: ImageBucket, assetId: string): Promise<void>;
  /** Removes image files no longer referenced by the listing document. Returns the count removed. */
  cleanupOrphans(listingId: string): Promise<number>;

  getSettings(): Promise<AppSettings | null>;
  saveSettings(settings: AppSettings): Promise<void>;

  listRecipes(): Promise<Recipe[]>;
  saveRecipe(recipe: Recipe): Promise<void>;
  deleteRecipe(recipeId: string): Promise<void>;

  /** Small non-secret JSON documents (usage counters, caches). Keys are `[a-z0-9_-]+`. */
  readMeta<T>(key: string): Promise<T | null>;
  writeMeta(key: string, value: unknown): Promise<void>;

  getUsage(): Promise<StorageUsage>;
  /** Wipes every listing, image, recipe and setting. */
  clearAll(): Promise<void>;
}
