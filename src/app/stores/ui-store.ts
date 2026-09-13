import { create } from "zustand";

export type GalleryFilter = "all" | "toPost";

interface UiState {
  sidebarOpen: boolean;
  setSidebarOpen(open: boolean): void;
  /** Multi-select in the gallery (asset ids). */
  selection: Set<string>;
  toggleSelected(assetId: string, additive?: boolean): void;
  selectMany(assetIds: string[]): void;
  clearSelection(): void;
  /**
   * Drops the state that belongs to one listing (selection, fullscreen viewer, compare) when the
   * workspace opens or leaves a listing: it lives here, not in the view, so it would otherwise survive
   * a trip through the sidebar and reappear on the way back.
   */
  leaveListing(): void;
  /** Fullscreen viewer: asset id currently shown, or null. */
  lightboxAssetId: string | null;
  openLightbox(assetId: string): void;
  closeLightbox(): void;
  compareMode: boolean;
  setCompareMode(v: boolean): void;
  filter: GalleryFilter;
  setFilter(f: GalleryFilter): void;
  /** A photo is being turned into a listing (decode, thumbnail, save): the app shows it is busy. */
  importing: boolean;
  setImporting(v: boolean): void;
  /** Whether the composer is shown on small screens. */
  mobileComposerOpen: boolean;
  setMobileComposerOpen(v: boolean): void;
}

export const useUiStore = create<UiState>((set, get) => ({
  sidebarOpen: false,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  importing: false,
  setImporting: (importing) => set({ importing }),
  selection: new Set(),
  toggleSelected: (assetId, additive = true) => {
    const next = additive ? new Set(get().selection) : new Set<string>();
    if (get().selection.has(assetId) && additive) next.delete(assetId);
    else next.add(assetId);
    set({ selection: next });
  },
  selectMany: (assetIds) => set({ selection: new Set(assetIds) }),
  clearSelection: () => set({ selection: new Set() }),
  leaveListing: () => set({ selection: new Set(), lightboxAssetId: null, compareMode: false }),
  lightboxAssetId: null,
  openLightbox: (lightboxAssetId) => set({ lightboxAssetId }),
  closeLightbox: () => set({ lightboxAssetId: null, compareMode: false }),
  compareMode: false,
  setCompareMode: (compareMode) => set({ compareMode }),
  filter: "all",
  setFilter: (filter) => set({ filter }),
  mobileComposerOpen: true,
  setMobileComposerOpen: (mobileComposerOpen) => set({ mobileComposerOpen }),
}));
