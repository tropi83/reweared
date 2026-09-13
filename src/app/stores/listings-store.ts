import { create } from "zustand";
import {
  AppError,
  CURRENT_SCHEMA_VERSION,
  summarize,
  type GenerationJob,
  type ImageAsset,
  type ImageMimeType,
  type ListingDocument,
  type ListingSummary,
} from "@/domain/models";
import { createThumbnail, decodeImage, validateImageFile } from "@/infrastructure/image/image-processing";
import { createId, nowIso } from "@/lib/ids";
import { createLogger } from "@/lib/logger";
import { evictImageUrls, primeImageUrl } from "../image-urls";
import { getServices } from "../services";

const log = createLogger("listings");

interface ListingsState {
  summaries: ListingSummary[];
  current: ListingDocument | null;
  loadingList: boolean;
  loadingListing: boolean;
  loadSummaries(): Promise<void>;
  open(listingId: string): Promise<ListingDocument | null>;
  close(): void;
  createFromFile(file: Blob, fileName?: string): Promise<ListingDocument>;
  rename(listingId: string, name: string): Promise<void>;
  remove(listingId: string): Promise<void>;
  duplicate(listingId: string): Promise<ListingDocument | null>;
  /** Applies a synchronous mutation to the open listing and schedules a save. */
  commit(mutator: (doc: ListingDocument) => void, options?: { immediate?: boolean }): void;
  flush(): Promise<void>;
  toggleToPost(assetId: string): void;
  deleteImages(assetIds: string[]): Promise<void>;
  deleteGeneration(generationId: string): Promise<void>;
  /** Stores a generated result (full image + thumbnail) and links it to its job. */
  addResultImage(job: GenerationJob, blob: Blob, mimeType: ImageMimeType): Promise<string>;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let savePromise: Promise<void> | null = null;

function scheduleSave(get: () => ListingsState, immediate: boolean) {
  if (saveTimer) clearTimeout(saveTimer);
  const run = async () => {
    saveTimer = null;
    const doc = get().current;
    if (!doc) return;
    try {
      await getServices().storage.saveListing(doc);
    } catch (err) {
      log.error("save failed", err);
    }
    // Keep the sidebar in sync without reloading everything.
    const summary = summarize(doc);
    const summaries = get().summaries.some((s) => s.id === summary.id)
      ? get().summaries.map((s) => (s.id === summary.id ? summary : s))
      : [summary, ...get().summaries];
    useListingsStore.setState({ summaries: summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) });
  };
  if (immediate) {
    savePromise = run();
  } else {
    saveTimer = setTimeout(() => {
      savePromise = run();
    }, 250);
  }
}

async function storeImageWithThumbnail(listingId: string, kind: ImageAsset["kind"], blob: Blob, mimeType: ImageMimeType, extra: Partial<ImageAsset>) {
  const { storage } = getServices();
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
    await storage.writeImage(listingId, kind, asset.id, blob);
    await storage.writeImage(listingId, "thumbnail", asset.id, thumbnail);
  } catch (err) {
    await storage.deleteImage(listingId, kind, asset.id).catch(() => undefined);
    await storage.deleteImage(listingId, "thumbnail", asset.id).catch(() => undefined);
    throw new AppError("STORAGE_ERROR", "The image could not be saved on this device.", { cause: err });
  }
  primeImageUrl(listingId, kind, asset.id, blob);
  primeImageUrl(listingId, "thumbnail", asset.id, thumbnail);
  return asset;
}

export const useListingsStore = create<ListingsState>((set, get) => ({
  summaries: [],
  current: null,
  loadingList: false,
  loadingListing: false,

  async loadSummaries() {
    set({ loadingList: true });
    try {
      set({ summaries: await getServices().storage.listListings() });
    } finally {
      set({ loadingList: false });
    }
  },

  async open(listingId) {
    if (get().current?.listing.id === listingId) return get().current;
    // Jobs of the listing being left would otherwise run on against a closed document and fail one by one.
    const { queue } = getServices();
    if (queue.activeCount > 0) {
      queue.cancelAll();
      await queue.settled();
    }
    await get().flush();
    set({ loadingListing: true });
    try {
      const doc = await getServices().storage.getListing(listingId);
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
      set({ current: doc });
      return doc;
    } finally {
      set({ loadingListing: false });
    }
  },

  close() {
    void get().flush();
    set({ current: null });
  },

  async createFromFile(file, fileName) {
    const validated = await validateImageFile(file);
    const listingId = createId("lst");
    const mime: ImageMimeType = validated.mimeType === "image/jpeg" ? "image/jpeg" : validated.mimeType === "image/png" ? "image/png" : "image/webp";
    // Non-native formats (gif/bmp/avif) are re-encoded losslessly to PNG so every stored original is a web-safe file.
    let blob = validated.blob;
    let storedMime = mime;
    if (validated.mimeType !== "image/png" && validated.mimeType !== "image/jpeg" && validated.mimeType !== "image/webp") {
      const { encodeBitmap } = await import("@/infrastructure/image/image-processing");
      const decoded = await decodeImage(validated.blob);
      try {
        blob = (await encodeBitmap(decoded.bitmap, { type: "image/png" })).blob;
      } finally {
        decoded.bitmap.close();
      }
      storedMime = "image/png";
    }
    const asset = await storeImageWithThumbnail(listingId, "original", blob, storedMime, fileName ? { fileName } : {});
    const now = nowIso();
    const baseName = (fileName ?? "").replace(/\.[^.]+$/, "").trim();
    const doc: ListingDocument = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      appVersion: getServices().appVersion,
      listing: { id: listingId, name: baseName || "Untitled listing", originalImageId: asset.id, coverImageId: asset.id, createdAt: now, updatedAt: now },
      images: { [asset.id]: asset },
      generations: {},
      jobs: {},
      toPost: [],
    };
    await getServices().storage.saveListing(doc);
    await get().flush();
    set({ current: doc, summaries: [summarize(doc), ...get().summaries] });
    return doc;
  },

  async rename(listingId, name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (get().current?.listing.id === listingId) {
      get().commit((doc) => {
        doc.listing.name = trimmed;
      });
      return;
    }
    const doc = await getServices().storage.getListing(listingId);
    if (!doc) return;
    doc.listing.name = trimmed;
    doc.listing.updatedAt = nowIso();
    await getServices().storage.saveListing(doc);
    set({ summaries: get().summaries.map((s) => (s.id === listingId ? summarize(doc) : s)) });
  },

  async remove(listingId) {
    if (get().current?.listing.id === listingId) {
      // Running jobs abort on the next tick: wait for them so nothing is written into the folder being removed.
      getServices().queue.cancelAll();
      await getServices().queue.settled();
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = null;
      set({ current: null });
    }
    await getServices().storage.deleteListing(listingId);
    evictImageUrls(listingId);
    set({ summaries: get().summaries.filter((s) => s.id !== listingId) });
  },

  async duplicate(listingId) {
    const { storage } = getServices();
    const source = await storage.getListing(listingId);
    if (!source) return null;
    const newId = createId("lst");
    const now = nowIso();
    const doc: ListingDocument = structuredClone(source);
    doc.listing = { ...doc.listing, id: newId, name: `${source.listing.name} (copy)`, createdAt: now, updatedAt: now };
    for (const image of Object.values(doc.images)) image.listingId = newId;
    for (const gen of Object.values(doc.generations)) gen.listingId = newId;
    for (const job of Object.values(doc.jobs)) job.listingId = newId;
    for (const image of Object.values(source.images)) {
      for (const bucket of [image.kind, "thumbnail"] as const) {
        const blob = await storage.readImage(listingId, bucket, image.id);
        if (blob) await storage.writeImage(newId, bucket, image.id, blob);
      }
    }
    await storage.saveListing(doc);
    set({ summaries: [summarize(doc), ...get().summaries] });
    return doc;
  },

  commit(mutator, options) {
    const current = get().current;
    if (!current) return;
    const next = structuredClone(current);
    mutator(next);
    next.listing.updatedAt = nowIso();
    set({ current: next });
    scheduleSave(get, options?.immediate ?? false);
  },

  async flush() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
      const doc = get().current;
      if (doc) {
        savePromise = getServices()
          .storage.saveListing(doc)
          .catch((err) => log.error("flush failed", err));
      }
    }
    await savePromise;
  },

  toggleToPost(assetId) {
    get().commit((doc) => {
      const idx = doc.toPost.indexOf(assetId);
      if (idx >= 0) doc.toPost.splice(idx, 1);
      else doc.toPost.push(assetId);
    });
  },

  async deleteImages(assetIds) {
    const current = get().current;
    if (!current) return;
    const { storage, queue } = getServices();
    const ids = new Set(assetIds.filter((id) => id !== current.listing.originalImageId));
    get().commit(
      (doc) => {
        for (const id of ids) {
          const asset = doc.images[id];
          if (!asset) continue;
          delete doc.images[id];
          doc.toPost = doc.toPost.filter((f) => f !== id);
          if (asset.jobId) {
            const job = doc.jobs[asset.jobId];
            if (job) {
              queue.cancel(job.id);
              delete doc.jobs[job.id];
              const gen = doc.generations[job.generationId];
              if (gen) {
                gen.jobIds = gen.jobIds.filter((j) => j !== job.id);
                if (gen.jobIds.length === 0) delete doc.generations[gen.id];
              }
            }
          }
          if (doc.listing.coverImageId === id) doc.listing.coverImageId = doc.listing.originalImageId;
        }
      },
      { immediate: true },
    );
    for (const id of ids) {
      const asset = current.images[id];
      if (!asset) continue;
      await storage.deleteImage(current.listing.id, asset.kind, id).catch((err) => log.warn("delete image failed", err));
      await storage.deleteImage(current.listing.id, "thumbnail", id).catch(() => undefined);
      evictImageUrls(current.listing.id, id);
    }
  },

  async deleteGeneration(generationId) {
    const current = get().current;
    if (!current) return;
    const gen = current.generations[generationId];
    if (!gen) return;
    getServices().queue.cancelGeneration(generationId);
    const imageIds = gen.jobIds.map((j) => current.jobs[j]?.resultImageId).filter((id): id is string => !!id);
    await get().deleteImages(imageIds);
    get().commit(
      (doc) => {
        for (const jobId of gen.jobIds) delete doc.jobs[jobId];
        delete doc.generations[generationId];
      },
      { immediate: true },
    );
  },

  async addResultImage(job, blob, mimeType) {
    const current = get().current;
    if (!current || current.listing.id !== job.listingId) {
      throw new AppError("CANCELLED", "The listing was closed before the result arrived.", { retryable: false });
    }
    const asset = await storeImageWithThumbnail(job.listingId, "generation", blob, mimeType, { generationId: job.generationId, jobId: job.id });
    get().commit((doc) => {
      doc.images[asset.id] = asset;
    });
    return asset.id;
  },
}));

if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    void useListingsStore.getState().flush();
  });
}
