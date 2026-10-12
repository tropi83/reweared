import { afterEach, describe, expect, it, vi } from "vitest";
import { startHeartbeat } from "./heartbeat";

afterEach(() => vi.useRealTimers());

describe("worker heartbeat", () => {
  it("writes while Redis answers, stops writing (and logs once) when it does not", async () => {
    vi.useFakeTimers();
    let redisUp = true;
    const writes: string[] = [];
    const errors: unknown[] = [];
    let clock = 1_000;
    const stop = startHeartbeat(
      {
        ping: async () => {
          if (!redisUp) throw new Error("connection lost");
        },
        write: async (content) => void writes.push(content),
        now: () => clock,
        onError: (error) => errors.push(error),
      },
      10,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(writes).toEqual(["1000"]);

    redisUp = false;
    clock = 2_000;
    await vi.advanceTimersByTimeAsync(30);
    expect(writes).toEqual(["1000"]);
    expect(errors).toHaveLength(1);

    redisUp = true;
    clock = 3_000;
    await vi.advanceTimersByTimeAsync(10);
    expect(writes.at(-1)).toBe("3000");
    stop();
    await vi.advanceTimersByTimeAsync(50);
    expect(writes.at(-1)).toBe("3000");
  });

  it("counts a ping that never answers as a failure", async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const errors: unknown[] = [];
    const stop = startHeartbeat(
      { ping: () => new Promise(() => undefined), write: async (c) => void writes.push(c), now: () => 1, onError: (e) => errors.push(e) },
      100,
      20,
    );
    await vi.advanceTimersByTimeAsync(25);
    expect(writes).toEqual([]);
    expect(errors).toHaveLength(1);
    stop();
  });
});
