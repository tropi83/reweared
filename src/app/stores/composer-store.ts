import { create } from "zustand";
import type { AppSettings, AspectRatio } from "@aiv/domain/models";

/** The workspace's per-listing choices for the next run: which photo it starts from, and the output format. */
interface ComposerState {
  listingId: string | null;
  /** null = the listing's original image. */
  sourceImageId: string | null;
  aspectRatio: AspectRatio;
  setSource(assetId: string | null): void;
  setAspectRatio(ratio: AspectRatio): void;
  /** Called when a listing opens; the source goes back to the original. */
  bindListing(listingId: string | null): void;
  /** Seeds the format from the saved settings (startup and when the account's settings arrive). */
  applyDefaults(defaults: Pick<AppSettings, "defaultAspectRatio">): void;
}

export const useComposerStore = create<ComposerState>((set, get) => ({
  listingId: null,
  sourceImageId: null,
  aspectRatio: "original",
  setSource: (sourceImageId) => set({ sourceImageId }),
  setAspectRatio: (aspectRatio) => set({ aspectRatio }),
  bindListing: (listingId) => {
    if (listingId === get().listingId) return;
    set({ listingId, sourceImageId: null });
  },
  applyDefaults: (defaults) => set({ aspectRatio: defaults.defaultAspectRatio }),
}));
