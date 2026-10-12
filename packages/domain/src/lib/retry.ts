/** Exponential backoff with full jitter. Pure, so the queue and tests can share it. */
export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
  /** Random source in [0, 1). Injectable for deterministic tests. */
  random?: () => number;
}

export function computeBackoffMs(attempt: number, opts: BackoffOptions): number {
  const random = opts.random ?? Math.random;
  const exp = Math.min(opts.maxMs, opts.baseMs * 2 ** Math.max(0, attempt - 1));
  // Full jitter: uniform in [exp/2, exp] so retries still spread out but never collapse to 0.
  return Math.round(exp / 2 + random() * (exp / 2));
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function abortError(): Error {
  const err = new Error("Aborted");
  err.name = "AbortError";
  return err;
}

/** Combines a caller signal with a timeout into one signal. */
export function withTimeout(ms: number, parent?: AbortSignal): { signal: AbortSignal; clear: () => void; timedOut: () => boolean } {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);
  const onParentAbort = () => controller.abort();
  if (parent) {
    if (parent.aborted) controller.abort();
    else parent.addEventListener("abort", onParentAbort, { once: true });
  }
  return {
    signal: controller.signal,
    clear: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParentAbort);
    },
    timedOut: () => timedOut,
  };
}
