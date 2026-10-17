/** Worker liveness seen from the api: each worker records its heartbeat in a sorted set (score = time), so
 * `/api/v1/ready` can report a dead worker to the outside uptime check, which only sees the api. */
export const WORKER_HEARTBEATS_KEY = "worker:heartbeats";
/** A worker that has not beaten for this long is considered gone (it beats every 10 s). */
export const WORKER_STALE_MS = 60_000;

export interface LivenessRedis {
  zadd(key: string, score: number, member: string): Promise<unknown>;
  zremrangebyscore(key: string, min: number | string, max: number | string): Promise<unknown>;
  zcount(key: string, min: number | string, max: number | string): Promise<number>;
}

export async function publishWorkerHeartbeat(redis: LivenessRedis, workerId: string, now: number): Promise<void> {
  await redis.zadd(WORKER_HEARTBEATS_KEY, now, workerId);
  await redis.zremrangebyscore(WORKER_HEARTBEATS_KEY, "-inf", now - 10 * WORKER_STALE_MS);
}

/** Rejects when no worker beat recently. */
export async function assertWorkerAlive(redis: LivenessRedis, now: number): Promise<void> {
  const alive = await redis.zcount(WORKER_HEARTBEATS_KEY, now - WORKER_STALE_MS, "+inf");
  if (alive < 1) throw new Error("no worker heartbeat");
}
