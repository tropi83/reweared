import { create } from "zustand";
import { AppError, toGenerationError, type GenerationError, type ListingCopy, type ListingSelection } from "@/domain/models";
import { prepareForProvider } from "@/infrastructure/image/image-processing";
import { nowIso } from "@/lib/ids";
import { createLogger } from "@/lib/logger";
import { getServices } from "../services";
import { useProjectsStore } from "./projects-store";
import { useSettingsStore } from "./settings-store";

const log = createLogger("listing");

/** Vision models cap input resolution anyway; 1024 px keeps the request small and fast. */
const COPY_IMAGE_MAX_DIMENSION = 1024;

interface ListingState {
  copyBusy: boolean;
  copyError: GenerationError | null;
  setListing(selection: ListingSelection | undefined): void;
  /** Generates title/description from the original photo with the copy provider/model chosen in settings. */
  generateCopy(): Promise<ListingCopy | null>;
  updateCopy(patch: Partial<Pick<ListingCopy, "title" | "description" | "keywords" | "brand" | "color" | "condition">>): void;
  cancelCopy(): void;
}

let copyController: AbortController | null = null;

export const useListingStore = create<ListingState>((set) => ({
  copyBusy: false,
  copyError: null,

  setListing(selection) {
    useProjectsStore.getState().commit((doc) => {
      if (selection) doc.project.listing = selection;
      else delete doc.project.listing;
    });
  },

  async generateCopy() {
    const projects = useProjectsStore.getState();
    const doc = projects.current;
    const originalId = doc?.project.originalImageId;
    if (!doc || !originalId) return null;
    const asset = doc.images[originalId];
    const { copyProviderId: providerId, copyModelByProvider } = useSettingsStore.getState().settings;
    const provider = getServices().copyProviders.get(providerId);
    if (!asset || !provider) {
      set({ copyError: { code: "PROVIDER_UNAVAILABLE", message: "No vision model for this provider.", retryable: false } });
      return null;
    }
    copyController?.abort();
    copyController = new AbortController();
    const { signal } = copyController;
    set({ copyBusy: true, copyError: null });
    try {
      const blob = await getServices().storage.readImage(doc.project.id, asset.kind, asset.id);
      if (!blob) throw new AppError("INVALID_IMAGE", "The original image file is missing.");
      const prepared = await prepareForProvider(blob, asset.mimeType, { maxDimension: COPY_IMAGE_MAX_DIMENSION, format: "image/jpeg" });
      const language = useSettingsStore.getState().settings.locale;
      const result = await provider.describeListing(
        { image: { blob: prepared.blob, mimeType: prepared.mimeType }, ...(doc.project.listing ? { listing: doc.project.listing } : {}), language },
        { signal, ...(copyModelByProvider[providerId] ? { model: copyModelByProvider[providerId] } : {}) },
      );
      if (signal.aborted) return null;
      const copy: ListingCopy = {
        ...result.copy,
        language,
        generatedAt: nowIso(),
        provider: providerId,
        model: String(result.providerMeta?.model ?? ""),
      };
      useProjectsStore.getState().commit(
        (draft) => {
          draft.project.copy = copy;
        },
        { immediate: true },
      );
      getServices().usage.track({ provider: providerId, model: copy.model || "vision", outcome: "ok" });
      return copy;
    } catch (err) {
      if (signal.aborted) return null;
      const error = toGenerationError(err);
      log.warn("copy generation failed", error.code);
      set({ copyError: error });
      return null;
    } finally {
      if (copyController?.signal === signal) copyController = null;
      set({ copyBusy: false });
    }
  },

  updateCopy(patch) {
    useProjectsStore.getState().commit((doc) => {
      if (!doc.project.copy) return;
      doc.project.copy = { ...doc.project.copy, ...patch };
    });
  },

  cancelCopy() {
    copyController?.abort();
    copyController = null;
    set({ copyBusy: false });
  },
}));
