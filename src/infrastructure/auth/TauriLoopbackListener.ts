import type { LoopbackListener } from "./GoogleOAuthCredentialProvider";

/**
 * Bridges to the Rust loopback server (src-tauri/src/oauth.rs) that receives Google's
 * redirect on http://127.0.0.1:<port>/callback.
 */
export class TauriLoopbackListener implements LoopbackListener {
  private async invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  }

  start(): Promise<{ port: number }> {
    return this.invoke<{ port: number }>("oauth_loopback_start");
  }

  async waitForCallback(port: number, timeoutMs: number, signal?: AbortSignal) {
    const wait = this.invoke<{ code?: string; state?: string; error?: string }>("oauth_loopback_wait", { port, timeoutMs });
    if (!signal) return wait;
    return new Promise<{ code?: string; state?: string; error?: string }>((resolve, reject) => {
      const onAbort = () => {
        void this.cancel(port);
        const e = new Error("Aborted");
        e.name = "AbortError";
        reject(e);
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
      wait.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    });
  }

  cancel(port: number): Promise<void> {
    return this.invoke<void>("oauth_loopback_cancel", { port });
  }
}
