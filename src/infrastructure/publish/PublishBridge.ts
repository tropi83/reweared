import type { FillReport, PublishPayload } from "@/domain/services/publish";

export type VintedPath = "/items/new" | "/";

/**
 * How the platform posts on Vinted:
 * - `windowed` (desktop): the app drives a separate window step by step — open, navigate, prefill, poll, close.
 * - `delegated` (phones): one native screen does it all; `run` resolves with the report when the user leaves it.
 *   The other methods exist for the store's convenience and do nothing there.
 */
export type PublishMode = "windowed" | "delegated";

export interface PublishBridge {
  readonly supported: boolean;
  readonly mode: PublishMode;
  open(): Promise<void>;
  navigate(path: VintedPath): Promise<void>;
  prefill(payload: PublishPayload): Promise<void>;
  poll(): Promise<FillReport | null>;
  close(): Promise<void>;
  clearSession(): Promise<void>;
  onPage(cb: (url: string) => void): () => void;
  onClosed(cb: () => void): () => void;
  /** Delegated mode: opens the native Vinted screen with the payload; resolves when it closes (null = never filled). */
  run(payload: PublishPayload): Promise<FillReport | null>;
}
