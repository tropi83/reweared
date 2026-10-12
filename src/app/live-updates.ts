import { createLogger } from "@/lib/logger";
import { isTerminalStatus, type RunEvent } from "./ports/remote-run-engine";
import { invalidateCredits } from "./query/credits";
import { getServices } from "./services";
import { settleRemoteCopy } from "./stores/listing-setup-store";
import { useListingsStore } from "./stores/listings-store";

const log = createLogger("live");

/** Bursts of events (one per job) end in one read of the listing. */
const RELOAD_DELAY_MS = 300;
const SUMMARIES_DELAY_MS = 1_000;

let stop: (() => void) | null = null;
let reloadTimer: ReturnType<typeof setTimeout> | null = null;
let summariesTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * API mode, signed in: follows the account's SSE events. An event about the open listing reads its document again
 * (the server is the single source of truth, nothing is patched field by field); a reconnection does the same, for
 * the events missed meanwhile.
 */
export function startLiveUpdates(): void {
  const runs = getServices().runs;
  if (!runs || stop) return;
  stop = runs.watch(onEvent, scheduleReload);
}

export function stopLiveUpdates(): void {
  stop?.();
  stop = null;
  if (reloadTimer) clearTimeout(reloadTimer);
  if (summariesTimer) clearTimeout(summariesTimer);
  reloadTimer = summariesTimer = null;
}

export function onEvent(event: RunEvent): void {
  if (event.type === "credits") return invalidateCredits();
  if (event.type === "job") {
    void settleRemoteCopy(event);
    // A failed or cancelled job is refunded: the server sends no balance event, so the balance is read again.
    if (isTerminalStatus(event.status)) invalidateCredits();
  }
  if (event.listingId === useListingsStore.getState().current?.listing.id) scheduleReload();
  // Covers and names in the sidebar change when a photo or a copy is done (the server sends job events, and a
  // listing event after a copy).
  if (event.type !== "job" || isTerminalStatus(event.status)) scheduleSummaries();
}

function scheduleReload(): void {
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    void useListingsStore
      .getState()
      .reload()
      .catch((err: unknown) => log.warn("listing not reloaded", err));
  }, RELOAD_DELAY_MS);
}

function scheduleSummaries(): void {
  if (summariesTimer) clearTimeout(summariesTimer);
  summariesTimer = setTimeout(() => {
    summariesTimer = null;
    void useListingsStore
      .getState()
      .loadSummaries()
      .catch((err: unknown) => log.warn("listings not reloaded", err));
  }, SUMMARIES_DELAY_MS);
}
