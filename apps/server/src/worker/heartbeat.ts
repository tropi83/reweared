/** Where the worker proves it is alive; read by the container healthcheck (compose.yaml). On the /tmp tmpfs. */
export const HEARTBEAT_FILE = "/tmp/worker-alive";
export const HEARTBEAT_INTERVAL_MS = 10_000;
/** The queue connection never fails a command while Redis is away (BullMQ needs that): it waits. A ping that has
 * not answered by then counts as a failure. */
const PING_TIMEOUT_MS = 5_000;

export interface HeartbeatDeps {
  /** Redis answers: the worker can receive jobs. */
  ping(): Promise<unknown>;
  write(content: string): Promise<void>;
  /** Tells the api the worker is alive (readiness); a failure counts like a failed ping. */
  publish?(now: number): Promise<unknown>;
  now(): number;
  onError(error: unknown): void;
}

/**
 * Writes the heartbeat file every interval, only while Redis answers, so a stuck event loop or a lost queue
 * connection makes the file stale and the container unhealthy. Returns the stop function.
 */
export function startHeartbeat(deps: HeartbeatDeps, intervalMs = HEARTBEAT_INTERVAL_MS, pingTimeoutMs = PING_TIMEOUT_MS): () => void {
  let failing = false;
  const beat = async () => {
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Redis did not answer the ping")), pingTimeoutMs);
      });
      try {
        await Promise.race([deps.ping(), timeout]);
      } finally {
        clearTimeout(timer);
      }
      await deps.write(String(deps.now()));
      await deps.publish?.(deps.now());
      failing = false;
    } catch (error) {
      // One log line per outage, not one per beat.
      if (!failing) deps.onError(error);
      failing = true;
    }
  };
  void beat();
  const timer = setInterval(() => void beat(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
