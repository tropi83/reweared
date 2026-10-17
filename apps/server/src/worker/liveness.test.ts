import { describe, expect, it } from "vitest";
import { assertWorkerAlive, publishWorkerHeartbeat, WORKER_STALE_MS, type LivenessRedis } from "./liveness";

function fakeRedis(): LivenessRedis {
  const set = new Map<string, number>();
  return {
    zadd: async (_k, score, member) => void set.set(member, score),
    zremrangebyscore: async (_k, _min, max) => {
      for (const [m, s] of set) if (s <= Number(max)) set.delete(m);
    },
    zcount: async (_k, min) => [...set.values()].filter((s) => s >= Number(min)).length,
  };
}

describe("worker liveness", () => {
  it("is alive right after a beat and dead once the beat is stale", async () => {
    const redis = fakeRedis();
    await expect(assertWorkerAlive(redis, 1_000)).rejects.toThrow("no worker heartbeat");
    await publishWorkerHeartbeat(redis, "worker-a", 1_000);
    await expect(assertWorkerAlive(redis, 1_000 + WORKER_STALE_MS)).resolves.toBeUndefined();
    await expect(assertWorkerAlive(redis, 1_001 + WORKER_STALE_MS)).rejects.toThrow();
  });

  it("stays alive while one of several workers beats", async () => {
    const redis = fakeRedis();
    await publishWorkerHeartbeat(redis, "worker-a", 1_000);
    await publishWorkerHeartbeat(redis, "worker-b", 100_000);
    await expect(assertWorkerAlive(redis, 100_000)).resolves.toBeUndefined();
  });

  it("forgets workers that have been gone for long", async () => {
    const redis = fakeRedis();
    await publishWorkerHeartbeat(redis, "worker-old", 0);
    await publishWorkerHeartbeat(redis, "worker-new", 20 * WORKER_STALE_MS);
    expect(await redis.zcount("worker:heartbeats", 0, "+inf")).toBe(1);
  });
});
