import { create } from "zustand";
import { AppError, toGenerationError, type GenerationError, type ListingDocument } from "@/domain/models";
import { canPost, stageForUrl, VINTED_SELL_PATH, type FillReport, type PublishBlocker, type PublishStage } from "@/domain/services/publish";
import type { PollResult, PublishBridge } from "@/infrastructure/publish/PublishBridge";
import { createLogger } from "@/lib/logger";
import { publishBarText } from "../publish-bar";
import { buildPublishPayload } from "../publish-payload";
import { getServices } from "../services";
import { useListingsStore } from "./listings-store";
import { useSettingsStore } from "./settings-store";

const log = createLogger("publish");
export const POLL_INTERVAL_MS = 300;
export const POLL_TIMEOUT_MS = 20_000;
/** How often the open Vinted window is read (location + script status) while a session lasts. */
export const WATCH_INTERVAL_MS = 500;

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
  /**
   * Injects the copy and photos into the sell form and waits for the script's report. Runs by itself
   * as soon as the window reaches the sell form (page load or client-side navigation); the panel's
   * button runs it again by hand.
   */
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
async function runDelegated(bridge: PublishBridge, doc: ListingDocument, session: number, set: Set): Promise<void> {
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

type Set = (partial: Partial<PublishState> | ((s: PublishState) => Partial<PublishState>)) => void;

/** A page event or a poll said where the window is: derive the stage (the form keeps "filled" after a fill). */
function applyUrl(set: Set, url: string) {
  const stage = stageForUrl(url);
  set((s) => ({ session: { ...s.session, url, stage: s.session.stage === "filled" && stage === "form" ? "filled" : stage, error: undefined } }));
}

/**
 * Desktop: follows the window while the session lasts. Vinted is a single-page app, so its own
 * "Sell" entry reaches the form without a page-load event — the poll's `url` catches that. Fills on
 * arrival on the form and again when the document was replaced (the script and its status are gone);
 * meanwhile reflects the paste taps (`ready` → `filled`). Poll failures (window navigating) are skipped.
 */
async function watchWindow(bridge: PublishBridge, session: number, set: Set, get: () => PublishState): Promise<void> {
  let previous: PublishStage | undefined;
  while (session === epoch) {
    await sleep(WATCH_INTERVAL_MS);
    if (session !== epoch) return;
    let result: PollResult | null;
    try {
      result = await bridge.poll();
    } catch (err) {
      log.debug("watch poll skipped", err instanceof Error ? err.message : String(err));
      continue;
    }
    if (session !== epoch || !result) continue;
    const stage = stageForUrl(result.url);
    if (result.url !== get().session.url) applyUrl(set, result.url);
    const current = get().session;
    if (stage === "form" && !current.busy) {
      const arrived = previous !== "form";
      const reloaded = !!current.report && result.report === null;
      if (arrived || reloaded) void get().fill();
      else if (result.report) set((s) => ({ session: { ...s.session, report: result.report ?? undefined } }));
    }
    previous = stage;
  }
}

/** The status bar above vinted.com follows the session (desktop only; the phone screen has its own). */
function pushBarText(session: PublishSession, previous: PublishSession) {
  if (session === previous || session.stage === "closed") return;
  const bridge = getServices().publish;
  if (bridge.mode !== "windowed") return;
  const text = publishBarText(session);
  // A new session always gets its first line (the bar keeps it until the window shows it).
  if (previous.stage !== "closed" && text === publishBarText(previous)) return;
  bridge.status(text).catch((err: unknown) => log.debug("status bar not updated", err instanceof Error ? err.message : String(err)));
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
      applyUrl(set, url);
      // A real load of the form (navigate, reload): fill without waiting for the next poll.
      if (stageForUrl(url) === "form") void get().fill();
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
      return;
    }
    if (session !== epoch) return;
    void watchWindow(bridge, session, set, get);
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
        report = (await publish.poll())?.report ?? null;
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

usePublishStore.subscribe((state, previous) => pushBarText(state.session, previous.session));
