import { create } from "zustand";
import { AppError, summarize, toGenerationError, type GenerationJob, type ImageMimeType, type ListingDocument, type ListingSummary } from "@aiv/domain/models";
import { decodeImage, validateImageFile } from "@/infrastructure/image/image-processing";
import { nowIso } from "@aiv/domain/lib/ids";
import { createLogger } from "@/lib/logger";
import { evictImageUrls } from "../image-urls";
import { errorMessage } from "@/i18n/errors";
import { toast } from "./toast-store";
import { invalidateCredits } from "../query/credits";
import { getServices } from "../services";

const log = createLogger("listings");

interface ListingsState {
  summaries: ListingSummary[];
  current: ListingDocument | null;
  loadingList: boolean;
  loadingListing: boolean;
  loadSummaries(): Promise<void>;
  open(listingId: string): Promise<ListingDocument | null>;
  /** Reads the open listing again (API mode: after the server changed it), keeping edits not saved yet. */
  reload(): Promise<void>;
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
      await getServices().listings.save(doc);
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

export const useListingsStore = create<ListingsState>((set, get) => ({
  summaries: [],
  current: null,
  loadingList: false,
  loadingListing: false,

  async loadSummaries() {
    set({ loadingList: true });
    try {
      set({ summaries: await getServices().listings.list() });
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
      const doc = await getServices().listings.get(listingId);
      set({ current: doc });
      return doc;
    } finally {
      set({ loadingListing: false });
    }
  },

  async reload() {
    const id = get().current?.listing.id;
    if (!id) return;
    await get().flush();
    const doc = await getServices().listings.get(id);
    // Another listing may have been opened, or an edit made, while the request was out.
    if (!doc || get().current?.listing.id !== id || saveTimer) return;
    const summary = summarize(doc);
    set({ current: doc, summaries: get().summaries.map((s) => (s.id === id ? summary : s)) });
  },

  close() {
    void get().flush();
    set({ current: null });
  },

  async createFromFile(file, fileName) {
    const validated = await validateImageFile(file);
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
    const baseName = (fileName ?? "").replace(/\.[^.]+$/, "").trim();
    const doc = await getServices().listings.create(baseName || "Untitled listing", { blob, mimeType: storedMime, ...(fileName ? { fileName } : {}) });
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
    const doc = await getServices().listings.get(listingId);
    if (!doc) return;
    doc.listing.name = trimmed;
    doc.listing.updatedAt = nowIso();
    await getServices().listings.save(doc);
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
    await getServices().listings.delete(listingId);
    evictImageUrls(listingId);
    set({ summaries: get().summaries.filter((s) => s.id !== listingId) });
  },

  async duplicate(listingId) {
    const source = get().summaries.find((s) => s.id === listingId) ?? (await getServices().listings.get(listingId))?.listing;
    if (!source) return null;
    await get().flush();
    const doc = await getServices().listings.duplicate(listingId, `${source.name} (copy)`);
    if (!doc) return null;
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
          .listings.save(doc)
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
    const { listings, queue } = getServices();
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
      await listings.deleteImage(current.listing.id, asset).catch((err) => log.warn("delete image failed", err));
      evictImageUrls(current.listing.id, id);
    }
  },

  async deleteGeneration(generationId) {
    const current = get().current;
    if (!current) return;
    const gen = current.generations[generationId];
    if (!gen) return;
    const { runs } = getServices();
    if (runs) {
      // API mode: the server deletes the pack, its jobs and photos in one go, then the listing is read again.
      try {
        await runs.deletePack(generationId);
        // Unfinished jobs were refunded.
        invalidateCredits();
      } catch (err) {
        const error = toGenerationError(err);
        log.warn("pack not deleted", error.code);
        toast.error(errorMessage(error));
        return;
      }
      for (const jobId of gen.jobIds) {
        const imageId = current.jobs[jobId]?.resultImageId;
        if (imageId) evictImageUrls(current.listing.id, imageId);
      }
      await get().reload();
      return;
    }
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
    const asset = await getServices().listings.storeGeneratedImage(job.listingId, blob, mimeType, { generationId: job.generationId, jobId: job.id });
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
