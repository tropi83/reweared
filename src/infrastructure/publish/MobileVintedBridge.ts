import { AppError } from "@/domain/models";
import { isFillReport, type FillReport, type PublishPayload } from "@/domain/services/publish";
import { createLogger } from "@/lib/logger";
import type { PublishBridge, VintedPath } from "./PublishBridge";

const log = createLogger("vinted-mobile");

/** Injected so tests need no Tauri runtime; production passes @tauri-apps/api's invoke. */
export interface MobileIpc {
  invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>;
}

const noop = async () => undefined;

/**
 * Android / iOS: the `vinted-webview` plugin's native screen (src-tauri/plugins/vinted-webview).
 * The app cannot drive it step by step (its own WebView is paused underneath), so the whole job is
 * delegated: `run` hands over the payload and resolves with the fill report when the screen closes.
 */
export class MobileVintedBridge implements PublishBridge {
  readonly supported = true;
  readonly mode = "delegated" as const;
  constructor(private readonly ipc: MobileIpc) {}

  private async call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    try {
      return (await this.ipc.invoke(`plugin:vinted-webview|${cmd}`, args)) as T;
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      log.warn(cmd, "failed:", detail);
      const code = /too long|too many|too large|unsupported photo|invalid|already open/.test(detail) ? "INVALID_REQUEST" : "UNKNOWN_ERROR";
      throw new AppError(code, "The Vinted screen could not complete the action.", { detail, retryable: false });
    }
  }

  async run(payload: PublishPayload): Promise<FillReport | null> {
    const value = await this.call<{ report?: unknown } | null>("run", { payload });
    return isFillReport(value?.report) ? value.report : null;
  }
  clearSession() {
    return this.call<void>("clear_session");
  }

  // Windowed-mode steps: nothing to drive on a phone.
  open = noop;
  navigate: (path: VintedPath) => Promise<void> = noop;
  prefill: (payload: PublishPayload) => Promise<void> = noop;
  poll = async (): Promise<FillReport | null> => null;
  close = noop;
  onPage(): () => void {
    return () => undefined;
  }
  onClosed(): () => void {
    return () => undefined;
  }
}
