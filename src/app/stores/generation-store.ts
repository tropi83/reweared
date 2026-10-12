import { create } from "zustand";
import { AppError, toGenerationError, type AspectRatio, type Generation } from "@aiv/domain/models";
import { createLogger } from "@/lib/logger";
import { errorMessage } from "@/i18n/errors";
import { invalidateCredits } from "../query/credits";
import { getServices } from "../services";
import { useListingsStore } from "./listings-store";
import { toast } from "./toast-store";

const log = createLogger("generation");

export interface StartGenerationParams {
  sourceImageId: string;
  /** Catalogue shots of the listing's category (the server plans and prompts them). */
  shotIds: string[];
  aspectRatio: AspectRatio;
}

interface GenerationState {
  /** Starts a photo pack (or some of its shots) on the server; the listing is read again with the new jobs. */
  start(params: StartGenerationParams): Promise<Generation>;
  retryJob(jobId: string): void;
  retryFailed(generationId: string): void;
  /**
   * One more photo of this job's shot (same source and format, a fresh seed chosen by the server). The new tile
   * appears with the listing's next read; returns undefined (there is no local id to reveal).
   */
  regenerateJob(jobId: string): string | undefined;
  cancelJob(jobId: string): void;
  cancelGeneration(generationId: string): void;
  cancelAll(): void;
}

const SHOT_ID = /^[a-z0-9-]{1,40}$/;

/** A server request started from a button; its failure becomes a toast. */
function remote(action: Promise<unknown>, what: string): void {
  void action
    .then(() => {
      invalidateCredits();
      return useListingsStore.getState().reload();
    })
    .catch((err: unknown) => {
      const error = toGenerationError(err);
      log.warn(what, error.code);
      toast.error(errorMessage(error, "platform"));
    });
}

/** The open listing's jobs that are still queued or running, in `generationId` or all. */
function activeJobIds(generationId?: string): string[] {
  const doc = useListingsStore.getState().current;
  if (!doc) return [];
  return Object.values(doc.jobs)
    .filter((j) => (j.status === "queued" || j.status === "generating") && (!generationId || j.generationId === generationId))
    .map((j) => j.id);
}

export const useGenerationStore = create<GenerationState>((_set, get) => ({
  async start(params) {
    const listings = useListingsStore.getState();
    const doc = listings.current;
    if (!doc) throw new AppError("INVALID_REQUEST", "No open listing.");
    const shotIds = params.shotIds.filter((id) => SHOT_ID.test(id)).slice(0, 10);
    if (shotIds.length === 0) throw new AppError("INVALID_REQUEST", "Choose at least one shot of the pack.", { retryable: false });
    // The server reads the category, brand and mannequin from the listing: unsaved edits go first.
    await listings.flush();
    const run = await getServices().runs.startPhotos(doc.listing.id, { sourceImageId: params.sourceImageId, shotIds, aspectRatio: params.aspectRatio });
    invalidateCredits();
    await useListingsStore.getState().reload();
    const generation = useListingsStore.getState().current?.generations[run.generationId];
    if (!generation) throw new AppError("UNKNOWN_ERROR", "The run started but the listing could not be read again.");
    return generation;
  },

  retryJob(jobId) {
    if (!useListingsStore.getState().current?.jobs[jobId]) return;
    remote(getServices().runs.retry(jobId), "retry failed");
  },

  regenerateJob(jobId) {
    const doc = useListingsStore.getState().current;
    const job = doc?.jobs[jobId];
    if (!doc || !job || !doc.images[job.sourceImageId]) return undefined;
    if (job.status === "queued" || job.status === "generating") return undefined;
    if (job.shotId && SHOT_ID.test(job.shotId)) {
      remote(
        getServices().runs.startPhotos(doc.listing.id, { sourceImageId: job.sourceImageId, shotIds: [job.shotId], aspectRatio: job.aspectRatio }),
        "regenerate failed",
      );
    }
    return undefined;
  },

  retryFailed(generationId) {
    const doc = useListingsStore.getState().current;
    const gen = doc?.generations[generationId];
    if (!doc || !gen) return;
    for (const id of gen.jobIds) {
      const job = doc.jobs[id];
      if (job && (job.status === "failed" || job.status === "cancelled")) get().retryJob(id);
    }
  },

  cancelJob(jobId) {
    remote(getServices().runs.cancel(jobId), "cancel failed");
  },

  cancelGeneration(generationId) {
    for (const id of activeJobIds(generationId)) remote(getServices().runs.cancel(id), "cancel failed");
  },

  cancelAll() {
    for (const id of activeJobIds()) remote(getServices().runs.cancel(id), "cancel failed");
  },
}));
