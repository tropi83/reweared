import { create } from "zustand";
import { AppError, toGenerationError, type GenerationError } from "@/domain/models";
import { canPost, stageForUrl, VINTED_SELL_PATH, type FillReport, type PublishStage } from "@/domain/services/publish";
import { getPlatform } from "@/infrastructure/platform/capabilities";
import { createLogger } from "@/lib/logger";
import { buildPublishPayload } from "../publish-payload";
import { getServices } from "../services";
import { useProjectsStore } from "./projects-store";
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
  /** Opens the Vinted window; requires canPost() and the acknowledged automation warning. */
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

function desktop() {
  const p = getPlatform();
  return p.isTauri && !p.isMobile;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export const usePublishStore = create<PublishState>((set, get) => ({
  session: CLOSED,

  async start(options) {
    const doc = useProjectsStore.getState().current;
    const acknowledged = options?.acknowledgedOnce || useSettingsStore.getState().settings.vintedAutomationAcknowledged;
    if (!acknowledged || !canPost(doc, { desktop: desktop() }).ok) return;
    const bridge = getServices().publish;
    endSession();
    const session = epoch;
    const offPage = bridge.onPage((url) => {
      const stage = stageForUrl(url);
      // Staying on (or reloading) the form after a fill keeps "filled"; any other page resets to its own stage.
      set((s) => ({ session: { ...s.session, url, stage: s.session.stage === "filled" && stage === "form" ? "filled" : stage, error: undefined } }));
    });
    const offClosed = bridge.onClosed(() => {
      endSession();
      set({ session: { ...CLOSED, error: { code: "CANCELLED", message: "Vinted window closed.", retryable: false } } });
    });
    unsubscribe = () => {
      offPage();
      offClosed();
    };
    set({ session: { stage: "browsing", busy: false } });
    try {
      await bridge.open();
    } catch (err) {
      const error = toGenerationError(err);
      log.warn("open failed", error.code);
      if (session !== epoch) return;
      endSession();
      set({ session: { ...CLOSED, error } });
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
    const doc = useProjectsStore.getState().current;
    if (!doc || get().session.stage === "closed" || get().session.busy) return;
    const session = epoch;
    const stale = () => session !== epoch;
    const { publish, storage } = getServices();
    set((s) => ({ session: { ...s.session, busy: true, error: undefined, report: undefined } }));
    try {
      const payload = await buildPublishPayload(doc, (asset) => storage.readImage(doc.project.id, asset.kind, asset.id));
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
