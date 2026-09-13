import { create } from "zustand";
import { AppError, toGenerationError, type GenerationError, type ListingDocument } from "@/domain/models";
import { canPost, stageForUrl, VINTED_SELL_PATH, type FillReport, type PublishBlocker, type PublishStage } from "@/domain/services/publish";
import type { PublishBridge } from "@/infrastructure/publish/PublishBridge";
import { createLogger } from "@/lib/logger";
import { buildPublishPayload } from "../publish-payload";
import { getServices } from "../services";
import { useListingsStore } from "./listings-store";
import { useSettingsStore } from "./settings-store";

const log = createLogger("publish");
export const POLL_INTERVAL_MS = 300;
export const POLL_TIMEOUT_MS = 20_000;

/**
 * Where the user is in the Vinted window: closed → login | browsing → form → filled → closed.
 * `url` is the last page the isolated window reported (query/fragment already stripped by Rust).
 */
export interface PublishSession {
  stage: PublishStage;
  /** The listing whose photos and copy this session posts; other listings never fill through it. */
  listingId?: string;
  url?: string;
  busy: boolean;
  report?: FillReport;
  error?: GenerationError;
}

export interface StartOptions {
  /** The warning dialog was just confirmed for this run, without persisting the acknowledgement. */
  acknowledgedOnce?: boolean;
}

interface PublishState {
  session: PublishSession;
  /** Opens the Vinted window; requires postEligibility() and the acknowledged automation warning. */
  start(options?: StartOptions): Promise<void>;
  /** Brings the Vinted window back to the front. */
  focus(): Promise<void>;
  /** Navigates the Vinted window to the sell form. */
  openForm(): Promise<void>;
  /** Injects the copy and photos into the sell form and waits for the script's report. */
  fill(): Promise<void>;
  /** Closes the Vinted window and drops the session. */
  finish(): Promise<void>;
}

const CLOSED: PublishSession = { stage: "closed", busy: false };
let unsubscribe: (() => void) | null = null;
/**
 * Bumped whenever a session starts or ends. Async work (open, fill's poll loop) captures it and
 * drops its result once it no longer matches, so a stale fill never writes into a newer session.
 */
let epoch = 0;

function releaseListeners() {
  unsubscribe?.();
  unsubscribe = null;
}

function endSession() {
  releaseListeners();
  epoch++;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Whether `doc` can be posted from this platform (single source for the store, the button and the panel). */
export function postEligibility(doc: ListingDocument | null | undefined): { ok: boolean; reasons: PublishBlocker[] } {
  return canPost(doc, { supported: getServices().publish.supported });
}

/**
 * Phones: the native screen does the whole job while the app's WebView is paused underneath, so the
 * payload goes over up front and the session only changes when the screen comes back.
 */
async function runDelegated(
  bridge: PublishBridge,
  doc: ListingDocument,
  session: number,
  set: (partial: Partial<PublishState> | ((s: PublishState) => Partial<PublishState>)) => void,
): Promise<void> {
  const listingId = doc.listing.id;
  set({ session: { stage: "browsing", busy: true, listingId } });
  try {
    const { storage } = getServices();
    const payload = await buildPublishPayload(doc, (asset) => storage.readImage(listingId, asset.kind, asset.id));
    if (session !== epoch) return;
    const report = await bridge.run(payload);
    if (session !== epoch) return;
    endSession();
    if (report) set({ session: { stage: "filled", busy: false, listingId, report } });
    else set({ session: { ...CLOSED, listingId, error: { code: "CANCELLED", message: "Vinted screen closed.", retryable: false } } });
  } catch (err) {
    const error = toGenerationError(err);
    log.warn("delegated run failed", error.code);
    if (session !== epoch) return;
    endSession();
    set({ session: { ...CLOSED, listingId, error } });
  }
}

export const usePublishStore = create<PublishState>((set, get) => ({
  session: CLOSED,

  async start(options) {
    const doc = useListingsStore.getState().current;
    const acknowledged = options?.acknowledgedOnce || useSettingsStore.getState().settings.vintedAutomationAcknowledged;
    if (!doc || !acknowledged || !postEligibility(doc).ok) return;
    const listingId = doc.listing.id;
    const bridge = getServices().publish;
    endSession();
    const session = epoch;
    if (bridge.mode === "delegated") return runDelegated(bridge, doc, session, set);
    const offPage = bridge.onPage((url) => {
      const stage = stageForUrl(url);
      // Staying on (or reloading) the form after a fill keeps "filled"; any other page resets to its own stage.
      set((s) => ({ session: { ...s.session, url, stage: s.session.stage === "filled" && stage === "form" ? "filled" : stage, error: undefined } }));
    });
    const offClosed = bridge.onClosed(() => {
      endSession();
      set({ session: { ...CLOSED, listingId, error: { code: "CANCELLED", message: "Vinted window closed.", retryable: false } } });
    });
    unsubscribe = () => {
      offPage();
      offClosed();
    };
    set({ session: { stage: "browsing", busy: false, listingId } });
    try {
      await bridge.open();
    } catch (err) {
      const error = toGenerationError(err);
      log.warn("open failed", error.code);
      if (session !== epoch) return;
      endSession();
      set({ session: { ...CLOSED, listingId, error } });
    }
  },

  async focus() {
    await getServices()
      .publish.open()
      .catch((err: unknown) => set((s) => ({ session: { ...s.session, error: toGenerationError(err) } })));
  },

  async openForm() {
    await getServices()
      .publish.navigate(VINTED_SELL_PATH)
      .catch((err: unknown) => set((s) => ({ session: { ...s.session, error: toGenerationError(err) } })));
  },

  async fill() {
    const doc = useListingsStore.getState().current;
    const current = get().session;
    // Only the listing the session was opened for, and only while it is still postable (marks/copy may have changed).
    if (!doc || current.stage === "closed" || current.busy || doc.listing.id !== current.listingId || !postEligibility(doc).ok) return;
    const session = epoch;
    const stale = () => session !== epoch;
    const { publish, storage } = getServices();
    set((s) => ({ session: { ...s.session, busy: true, error: undefined, report: undefined } }));
    try {
      const payload = await buildPublishPayload(doc, (asset) => storage.readImage(doc.listing.id, asset.kind, asset.id));
      if (stale()) return;
      await publish.prefill(payload);
      const started = Date.now();
      let report: FillReport | null = null;
      while (!report || report.photos.attached < report.photos.requested) {
        if (Date.now() - started > POLL_TIMEOUT_MS) {
          if (report) break; // text filled, photos still loading: keep what we have
          throw new AppError("TIMEOUT", "The Vinted page did not answer.", { retryable: false });
        }
        await sleep(POLL_INTERVAL_MS);
        // Finished, window closed or a new session started while we were waiting.
        if (stale()) return;
        report = await publish.poll();
        if (report && !report.pageOk) break;
      }
      if (stale()) return;
      set((s) => ({ session: { ...s.session, busy: false, report: report ?? undefined, stage: report?.pageOk ? "filled" : s.session.stage } }));
    } catch (err) {
      const error = toGenerationError(err);
      log.warn("fill failed", error.code);
      if (stale()) return;
      set((s) => ({ session: { ...s.session, busy: false, error } }));
    }
  },

  async finish() {
    endSession();
    await getServices()
      .publish.close()
      .catch(() => undefined);
    set({ session: CLOSED });
  },
}));
