import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { summarize, type AppSettings, type ProjectDocument, type ProjectSummary, type Recipe } from "@/domain/models";
import { assertSafeId } from "@/lib/ids";
import { migrateProjectDocument, migrateSettings } from "./migrations";
import type { ImageBucket, StorageProvider, StorageUsage } from "./StorageProvider";

interface Schema extends DBSchema {
  projects: { key: string; value: ProjectDocument; indexes: { updatedAt: string } };
  images: {
    key: string;
    // Bytes are stored as ArrayBuffer rather than Blob: portable across engines and structured-clone safe.
    value: { key: string; projectId: string; bucket: ImageBucket; assetId: string; bytes: ArrayBuffer; type: string; size: number };
    indexes: { projectId: string };
  };
  settings: { key: string; value: AppSettings | unknown };
  recipes: { key: string; value: Recipe };
}

const DB_NAME = "ai-image-variations";
const DB_VERSION = 1;

function assertMetaKey(key: string): string {
  if (!/^[a-z0-9_-]{1,64}$/.test(key)) throw new Error("Invalid meta key");
  return key;
}

function imageKey(projectId: string, bucket: ImageBucket, assetId: string): string {
  return `${assertSafeId(projectId)}/${bucket}/${assertSafeId(assetId)}`;
}

/** Web storage: metadata and blobs in IndexedDB, scoped to the site origin. */
export class IndexedDbStorage implements StorageProvider {
  private db: IDBPDatabase<Schema> | null = null;

  constructor(private readonly dbName = DB_NAME) {}

  async init(): Promise<void> {
    if (this.db) return;
    this.db = await openDB<Schema>(this.dbName, DB_VERSION, {
      upgrade(db) {
        const projects = db.createObjectStore("projects", { keyPath: "project.id" });
        projects.createIndex("updatedAt", "project.updatedAt");
        const images = db.createObjectStore("images", { keyPath: "key" });
        images.createIndex("projectId", "projectId");
        db.createObjectStore("settings");
        db.createObjectStore("recipes", { keyPath: "id" });
      },
    });
  }

  private get store(): IDBPDatabase<Schema> {
    if (!this.db) throw new Error("Storage not initialized");
    return this.db;
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const docs = await this.store.getAll("projects");
    return docs.map((raw) => summarize(migrateProjectDocument(raw))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getProject(projectId: string): Promise<ProjectDocument | null> {
    const raw = await this.store.get("projects", projectId);
    return raw ? migrateProjectDocument(raw) : null;
  }

  async saveProject(doc: ProjectDocument): Promise<void> {
    await this.store.put("projects", structuredClone(doc));
  }

  async deleteProject(projectId: string): Promise<void> {
    const tx = this.store.transaction(["projects", "images"], "readwrite");
    await tx.objectStore("projects").delete(projectId);
    const images = tx.objectStore("images");
    let cursor = await images.index("projectId").openKeyCursor(projectId);
    while (cursor) {
      await images.delete(cursor.primaryKey);
      cursor = await cursor.continue();
    }
    await tx.done;
  }

  async writeImage(projectId: string, bucket: ImageBucket, assetId: string, blob: Blob): Promise<void> {
    const bytes = await blob.arrayBuffer();
    await this.store.put("images", { key: imageKey(projectId, bucket, assetId), projectId, bucket, assetId, bytes, type: blob.type, size: bytes.byteLength });
  }

  async readImage(projectId: string, bucket: ImageBucket, assetId: string): Promise<Blob | null> {
    const row = await this.store.get("images", imageKey(projectId, bucket, assetId));
    return row ? new Blob([row.bytes], { type: row.type }) : null;
  }

  async deleteImage(projectId: string, bucket: ImageBucket, assetId: string): Promise<void> {
    await this.store.delete("images", imageKey(projectId, bucket, assetId));
  }

  async cleanupOrphans(projectId: string): Promise<number> {
    const doc = await this.getProject(projectId);
    const rows = await this.store.getAllFromIndex("images", "projectId", projectId);
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
    const projectCount = await this.store.count("projects");
    let imageBytes = 0;
    let cursor = await this.store.transaction("images").store.openCursor();
    while (cursor) {
      imageBytes += cursor.value.size;
      cursor = await cursor.continue();
    }
    return { projectCount, imageBytes, location: "IndexedDB" };
  }

  async clearAll(): Promise<void> {
    const tx = this.store.transaction(["projects", "images", "settings", "recipes"], "readwrite");
    await Promise.all([
      tx.objectStore("projects").clear(),
      tx.objectStore("images").clear(),
      tx.objectStore("settings").clear(),
      tx.objectStore("recipes").clear(),
    ]);
    await tx.done;
  }
}
