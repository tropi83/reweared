import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { summarize, type AppSettings, type ListingDocument, type ListingSummary, type Recipe } from "@/domain/models";
import { assertSafeId } from "@/lib/ids";
import { migrateListingDocument, migrateSettings } from "./migrations";
import type { ImageBucket, StorageProvider, StorageUsage } from "./StorageProvider";

interface Schema extends DBSchema {
  listings: { key: string; value: ListingDocument; indexes: { updatedAt: string } };
  images: {
    key: string;
    // Bytes are stored as ArrayBuffer rather than Blob: portable across engines and structured-clone safe.
    value: { key: string; listingId: string; bucket: ImageBucket; assetId: string; bytes: ArrayBuffer; type: string; size: number };
    indexes: { listingId: string };
  };
  settings: { key: string; value: AppSettings | unknown };
  recipes: { key: string; value: Recipe };
}

const DB_NAME = "ai-image-variations";
/** v2 (2026-09-13): the "projects" store became "listings" (see migrations.ts, schema v3). */
const DB_VERSION = 2;

function assertMetaKey(key: string): string {
  if (!/^[a-z0-9_-]{1,64}$/.test(key)) throw new Error("Invalid meta key");
  return key;
}

function imageKey(listingId: string, bucket: ImageBucket, assetId: string): string {
  return `${assertSafeId(listingId)}/${bucket}/${assertSafeId(assetId)}`;
}

/** Web storage: metadata and blobs in IndexedDB, scoped to the site origin. */
export class IndexedDbStorage implements StorageProvider {
  private db: IDBPDatabase<Schema> | null = null;

  constructor(private readonly dbName = DB_NAME) {}

  async init(): Promise<void> {
    if (this.db) return;
    this.db = await openDB<Schema>(this.dbName, DB_VERSION, {
      async upgrade(db, oldVersion, _newVersion, tx) {
        if (oldVersion < 1) {
          const images = db.createObjectStore("images", { keyPath: "key" });
          images.createIndex("listingId", "listingId");
          db.createObjectStore("settings");
          db.createObjectStore("recipes", { keyPath: "id" });
        }
        const listings = db.createObjectStore("listings", { keyPath: "listing.id" });
        listings.createIndex("updatedAt", "listing.updatedAt");
        if (oldVersion === 1) {
          // Copy the v1 "projects" records into "listings" (migrated on read anyway) and drop the old store.
          // Everything runs inside the versionchange transaction: either all of it lands, or nothing does.
          const legacy = tx.objectStore("projects" as never) as unknown as { getAll(): Promise<unknown[]> };
          for (const raw of await legacy.getAll()) await listings.put(migrateListingDocument(raw));
          const images = tx.objectStore("images");
          images.deleteIndex("projectId" as never);
          images.createIndex("listingId", "listingId");
          let cursor = await images.openCursor();
          while (cursor) {
            const { projectId, ...rest } = cursor.value as typeof cursor.value & { projectId?: string };
            if (projectId !== undefined) await cursor.update({ ...rest, listingId: projectId });
            cursor = await cursor.continue();
          }
          db.deleteObjectStore("projects" as never);
        }
      },
    });
  }

  private get store(): IDBPDatabase<Schema> {
    if (!this.db) throw new Error("Storage not initialized");
    return this.db;
  }

  async listListings(): Promise<ListingSummary[]> {
    const docs = await this.store.getAll("listings");
    return docs.map((raw) => summarize(migrateListingDocument(raw))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getListing(listingId: string): Promise<ListingDocument | null> {
    const raw = await this.store.get("listings", listingId);
    return raw ? migrateListingDocument(raw) : null;
  }

  async saveListing(doc: ListingDocument): Promise<void> {
    await this.store.put("listings", structuredClone(doc));
  }

  async deleteListing(listingId: string): Promise<void> {
    const tx = this.store.transaction(["listings", "images"], "readwrite");
    await tx.objectStore("listings").delete(listingId);
    const images = tx.objectStore("images");
    let cursor = await images.index("listingId").openKeyCursor(listingId);
    while (cursor) {
      await images.delete(cursor.primaryKey);
      cursor = await cursor.continue();
    }
    await tx.done;
  }

  async writeImage(listingId: string, bucket: ImageBucket, assetId: string, blob: Blob): Promise<void> {
    const bytes = await blob.arrayBuffer();
    await this.store.put("images", { key: imageKey(listingId, bucket, assetId), listingId, bucket, assetId, bytes, type: blob.type, size: bytes.byteLength });
  }

  async readImage(listingId: string, bucket: ImageBucket, assetId: string): Promise<Blob | null> {
    const row = await this.store.get("images", imageKey(listingId, bucket, assetId));
    return row ? new Blob([row.bytes], { type: row.type }) : null;
  }

  async deleteImage(listingId: string, bucket: ImageBucket, assetId: string): Promise<void> {
    await this.store.delete("images", imageKey(listingId, bucket, assetId));
  }

  async cleanupOrphans(listingId: string): Promise<number> {
    const doc = await this.getListing(listingId);
    const rows = await this.store.getAllFromIndex("images", "listingId", listingId);
    let removed = 0;
    for (const row of rows) {
      const referenced = doc !== null && row.assetId in doc.images;
      if (!referenced) {
        await this.store.delete("images", row.key);
        removed++;
      }
    }
    return removed;
  }

  async getSettings(): Promise<AppSettings | null> {
    const raw = await this.store.get("settings", "app");
    return raw ? migrateSettings(raw) : null;
  }

  async readMeta<T>(key: string): Promise<T | null> {
    const raw = await this.store.get("settings", `meta:${assertMetaKey(key)}`);
    return (raw as T | undefined) ?? null;
  }

  async writeMeta(key: string, value: unknown): Promise<void> {
    await this.store.put("settings", structuredClone(value), `meta:${assertMetaKey(key)}`);
  }

  async saveSettings(settings: AppSettings): Promise<void> {
    await this.store.put("settings", structuredClone(settings), "app");
  }

  async listRecipes(): Promise<Recipe[]> {
    return this.store.getAll("recipes");
  }

  async saveRecipe(recipe: Recipe): Promise<void> {
    await this.store.put("recipes", structuredClone(recipe));
  }

  async deleteRecipe(recipeId: string): Promise<void> {
    await this.store.delete("recipes", recipeId);
  }

  async getUsage(): Promise<StorageUsage> {
    const listingCount = await this.store.count("listings");
    let imageBytes = 0;
    let cursor = await this.store.transaction("images").store.openCursor();
    while (cursor) {
      imageBytes += cursor.value.size;
      cursor = await cursor.continue();
    }
    return { listingCount, imageBytes, location: "IndexedDB" };
  }

  async clearAll(): Promise<void> {
    const tx = this.store.transaction(["listings", "images", "settings", "recipes"], "readwrite");
    await Promise.all([
      tx.objectStore("listings").clear(),
      tx.objectStore("images").clear(),
      tx.objectStore("settings").clear(),
      tx.objectStore("recipes").clear(),
    ]);
    await tx.done;
  }
}
