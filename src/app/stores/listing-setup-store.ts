import { create } from "zustand";
import { AppError, toGenerationError, type GenerationError, type ListingCopy, type CategorySelection, type ListingDocument } from "@aiv/domain/models";
import { buildShots } from "@aiv/domain/services/catalog";
import { normalizeMannequin } from "@aiv/domain/services/mannequin";
import { createLogger } from "@/lib/logger";
import { listingReadiness } from "../listing-readiness";
import { eventError, isTerminalStatus, type RunEvent } from "../ports/remote-run-engine";
import { creditsSnapshot, invalidateCredits, listingRunCost, platformSnapshot } from "../query/credits";
import { getServices } from "../services";
import { useComposerStore } from "./composer-store";
import { useGenerationStore } from "./generation-store";
import { useListingsStore } from "./listings-store";
import { useSettingsStore } from "./settings-store";

/** The listing name derived from a copy title: trimmed, or undefined when there is nothing to name it with. */
function nameFromTitle(title: string): string | undefined {
  const trimmed = title.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const log = createLogger("listing");

export const BRAND_MAX_LENGTH = 60;

export type ListingPartOutcome = "done" | { error: GenerationError };
export interface ListingRunReport {
  photos: ListingPartOutcome;
  text: ListingPartOutcome;
}

interface ListingState {
  copyBusy: boolean;
  copyError: GenerationError | null;
  /** A "Create the listing" run is being started. */
  creating: boolean;
  /** Outcome of the last run, per part (UI summary). */
  lastRun: ListingRunReport | null;
  /** Listing the last run belongs to (the report is not shown on another listing). */
  lastRunListingId: string | null;
  setCategory(selection: CategorySelection | undefined): void;
  /** Stores the brand as typed (max 60 chars); blank removes it. */
  setBrand(raw: string): void;
  setUseMannequin(on: boolean): void;
  /** Has the server write the title and description from the original photo; resolves when its job ends. */
  generateCopy(): Promise<ListingCopy | null>;
  /** The main button: the photo pack and the text, started together on the server. */
  generateListing(): Promise<ListingRunReport | null>;
  cancelListingRun(): void;
  updateCopy(patch: Partial<Pick<ListingCopy, "title" | "description" | "keywords" | "brand" | "color" | "condition">>): void;
  cancelCopy(): void;
}

/** The copy job started by `generateCopy`, settled by its SSE event (`settleRemoteCopy`). */
let pendingCopy: { jobId: string; resolve: (copy: ListingCopy | null) => void } | null = null;

/**
 * Live job event: ends the pending copy run. The server wrote the copy and renamed the listing; the open listing is
 * read again to show them.
 */
export async function settleRemoteCopy(event: Extract<RunEvent, { type: "job" }>): Promise<void> {
  const pending = pendingCopy;
  if (!pending || pending.jobId !== event.jobId || !isTerminalStatus(event.status)) return;
  pendingCopy = null;
  if (event.status === "completed") {
    await useListingsStore
      .getState()
      .reload()
      .catch((err: unknown) => log.warn("listing not reloaded", err));
    useListingSetupStore.setState({ copyBusy: false });
    pending.resolve(useListingsStore.getState().current?.listing.copy ?? null);
    return;
  }
  const error = event.status === "cancelled" ? { code: "CANCELLED" as const, message: "Cancelled.", retryable: false } : eventError(event.error);
  useListingSetupStore.setState({ copyBusy: false, copyError: error });
  pending.resolve(null);
}

/** The balance and the run's cost when both are known (the server checks again and answers 402). */
export function runCredits(selection: CategorySelection | undefined): { credits?: { balance: number; cost: number } } {
  const credits = creditsSnapshot();
  const platform = platformSnapshot();
  if (!credits || !platform || !selection) return {};
  const settings = useSettingsStore.getState().settings;
  const doc = useListingsStore.getState().current;
  const mannequin = doc?.listing.useMannequin ? normalizeMannequin(settings.mannequin) : undefined;
  return { credits: { balance: credits.balance, cost: listingRunCost(platform, buildShots(selection, mannequin ? { mannequin } : {}).length) } };
}

/** The photo pack is planned and charged by the server from the listing's category and mannequin choice. */
async function startPhotos(doc: ListingDocument, sourceImageId: string): Promise<ListingPartOutcome> {
  try {
    await useListingsStore.getState().flush();
    const { aspectRatio } = useComposerStore.getState();
    await getServices().runs.startPhotos(doc.listing.id, { sourceImageId, aspectRatio });
    invalidateCredits();
    await useListingsStore.getState().reload();
    return "done";
  } catch (err) {
    const error = toGenerationError(err);
    log.warn("listing photos failed to start", error.code);
    return { error };
  }
}

export const useListingSetupStore = create<ListingState>((set, get) => ({
  copyBusy: false,
  copyError: null,
  creating: false,
  lastRun: null,
  lastRunListingId: null,

  setCategory(selection) {
    useListingsStore.getState().commit((doc) => {
      if (selection) doc.listing.category = selection;
      else delete doc.listing.category;
    });
  },

  setBrand(raw) {
    const value = raw.slice(0, BRAND_MAX_LENGTH);
    useListingsStore.getState().commit((doc) => {
      if (value.trim()) doc.listing.brand = value;
      else delete doc.listing.brand;
    });
  },

  setUseMannequin(on) {
    useListingsStore.getState().commit((doc) => {
      if (on) doc.listing.useMannequin = true;
      else delete doc.listing.useMannequin;
    });
  },

  async generateCopy() {
    const doc = useListingsStore.getState().current;
    if (!doc?.listing.originalImageId) return null;
    pendingCopy?.resolve(null);
    pendingCopy = null;
    set({ copyBusy: true, copyError: null });
    try {
      // The server reads the brand and category from the listing: unsaved edits go first.
      await useListingsStore.getState().flush();
      const run = await getServices().runs.startCopy(doc.listing.id, useSettingsStore.getState().settings.locale);
      invalidateCredits();
      const jobId = run.jobIds[0];
      if (!jobId) throw new AppError("UNKNOWN_ERROR", "The server started no copy job.");
      return await new Promise<ListingCopy | null>((resolve) => {
        pendingCopy = { jobId, resolve };
      });
    } catch (err) {
      const error = toGenerationError(err);
      log.warn("copy run failed to start", error.code);
      set({ copyBusy: false, copyError: error });
      return null;
    }
  },

  async generateListing() {
    const doc = useListingsStore.getState().current;
    const selection = doc?.listing.category;
    const sourceImageId = useComposerStore.getState().sourceImageId ?? doc?.listing.originalImageId;
    const readiness = listingReadiness({ hasImage: !!doc?.listing.originalImageId && !!sourceImageId, hasSelection: !!selection, ...runCredits(selection) });
    if (!doc || !selection || !sourceImageId || !readiness.canCreate || get().creating) return null;
    set({ creating: true, lastRun: null, lastRunListingId: doc.listing.id });
    const photos = startPhotos(doc, sourceImageId);
    const text = get()
      .generateCopy()
      .then<ListingPartOutcome>((result) => (result ? "done" : { error: get().copyError ?? { code: "CANCELLED", message: "Cancelled.", retryable: false } }));
    // Independent parts: one failing never cancels or rolls back the other.
    const [p, t] = await Promise.allSettled([photos, text]);
    const settled = (r: PromiseSettledResult<ListingPartOutcome>): ListingPartOutcome =>
      r.status === "fulfilled" ? r.value : { error: toGenerationError(r.reason) };
    const report: ListingRunReport = { photos: settled(p), text: settled(t) };
    set({ creating: false, lastRun: report });
    return report;
  },

  cancelListingRun() {
    useGenerationStore.getState().cancelAll();
    get().cancelCopy();
  },

  updateCopy(patch) {
    useListingsStore.getState().commit((doc) => {
      if (!doc.listing.copy) return;
      doc.listing.copy = { ...doc.listing.copy, ...patch };
      // Editing the title keeps the listing's name in step; an emptied field keeps the last name.
      if (patch.title !== undefined) doc.listing.name = nameFromTitle(patch.title) ?? doc.listing.name;
    });
  },

  cancelCopy() {
    const pending = pendingCopy;
    pendingCopy = null;
    if (pending) {
      void getServices()
        .runs.cancel(pending.jobId)
        .catch((err: unknown) => log.warn("copy not cancelled", err));
      pending.resolve(null);
    }
    set({ copyBusy: false });
  },
}));
