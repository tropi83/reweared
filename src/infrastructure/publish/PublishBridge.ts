import type { FillReport, PublishPayload } from "@/domain/services/publish";

export type VintedPath = "/items/new" | "/";

/**
 * How the platform posts on Vinted:
 * - `windowed` (desktop): the app drives a separate window step by step — open, navigate, prefill, poll, close.
 * - `delegated` (phones): one native screen does it all; `run` resolves with the report when the user leaves it.
 *   The other methods exist for the store's convenience and do nothing there.
 */
export type PublishMode = "windowed" | "delegated";

/**
 * One read of the Vinted window: where it is (`scheme://host[:port]/path`, query and fragment already
 * stripped by Rust) and the script's report — `null` until the script has decided, or when it is not in
 * the page (new document). Vinted is a single-page app: its own menu reaches the sell form without any
 * page-load event, so the store follows `url` through this poll.
 */
export interface PollResult {
  url: string;
  report: FillReport | null;
}

export interface PublishBridge {
  readonly supported: boolean;
  readonly mode: PublishMode;
  open(): Promise<void>;
  navigate(path: VintedPath): Promise<void>;
  prefill(payload: PublishPayload): Promise<void>;
  /** Windowed mode; `null` when the window is not open. */
  poll(): Promise<PollResult | null>;
  close(): Promise<void>;
  clearSession(): Promise<void>;
  onPage(cb: (url: string) => void): () => void;
  onClosed(cb: () => void): () => void;
  /** Delegated mode: opens the native Vinted screen with the payload; resolves when it closes (null = never filled). */
  run(payload: PublishPayload): Promise<FillReport | null>;
}
