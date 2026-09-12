import type { FillReport, PublishPayload } from "@/domain/services/publish";

export type VintedPath = "/items/new" | "/";

export interface PublishBridge {
  readonly supported: boolean;
  open(): Promise<void>;
  navigate(path: VintedPath): Promise<void>;
  prefill(payload: PublishPayload): Promise<void>;
  poll(): Promise<FillReport | null>;
  close(): Promise<void>;
  clearSession(): Promise<void>;
  onPage(cb: (url: string) => void): () => void;
  onClosed(cb: () => void): () => void;
}
