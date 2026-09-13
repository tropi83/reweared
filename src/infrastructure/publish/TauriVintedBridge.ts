import { AppError } from "@/domain/models";
import { isFillReport, type PublishPayload } from "@/domain/services/publish";
import { createLogger } from "@/lib/logger";
import type { PollResult, PublishBridge, VintedPath } from "./PublishBridge";

const log = createLogger("vinted-bridge");

/** Injected so tests need no Tauri runtime; production passes @tauri-apps/api's invoke/listen. */
export interface TauriIpc {
  invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
  listen(event: string, cb: (e: { payload: unknown }) => void): Promise<() => void>;
}

export class TauriVintedBridge implements PublishBridge {
  readonly supported = true;
  readonly mode = "windowed" as const;
  constructor(private readonly ipc: TauriIpc) {}

  private async call<T = void>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    try {
      return (await this.ipc.invoke(cmd, args)) as T;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      log.warn(cmd, "failed:", detail);
      const code = /not allowed|too long|too many|too large|unsupported|invalid/.test(detail)
        ? "INVALID_REQUEST"
        : /timed out/.test(detail)
          ? "TIMEOUT"
          : "UNKNOWN_ERROR";
      throw new AppError(code, "The Vinted window could not complete the action.", { detail, retryable: false });
    }
  }

  open() {
    return this.call("vinted_open");
  }
  navigate(path: VintedPath) {
    return this.call("vinted_navigate", { path });
  }
  prefill(payload: PublishPayload) {
    return this.call("vinted_prefill", { payload });
  }
  async poll(): Promise<PollResult | null> {
    const value = await this.call<{ url?: unknown; status?: unknown } | null>("vinted_poll");
    if (!value || typeof value.url !== "string") return null;
    return { url: value.url, report: isFillReport(value.status) ? value.status : null };
  }
  status(text: string) {
    return this.call("vinted_status", { text });
  }
  close() {
    return this.call("vinted_close");
  }
  clearSession() {
    return this.call("vinted_clear_session");
  }
  run(): Promise<never> {
    return Promise.reject(new AppError("INVALID_REQUEST", "The desktop window is driven step by step.", { retryable: false }));
  }

  private subscribe(event: string, cb: (payload: unknown) => void): () => void {
    let off: (() => void) | undefined;
    let cancelled = false;
    void this.ipc
      .listen(event, (e) => cb(e.payload))
      .then((unlisten) => {
        if (cancelled) unlisten();
        else off = unlisten;
      })
      .catch((err) => log.warn(event, "listen failed:", err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
      off?.();
    };
  }
  onPage(cb: (url: string) => void) {
    return this.subscribe("vinted:page", (p) => {
      const url = (p as { url?: unknown } | null)?.url;
      if (typeof url === "string") cb(url);
    });
  }
  onClosed(cb: () => void) {
    return this.subscribe("vinted:closed", () => cb());
  }
}
