import { describe, expect, it } from "vitest";
import { computeBackoffMs, sleep, withTimeout } from "./retry";

describe("retry helpers", () => {
  it("grows exponentially with jitter and caps at maxMs", () => {
    const opts = { baseMs: 100, maxMs: 1000, random: () => 0.5 };
    expect(computeBackoffMs(1, opts)).toBe(75);
    expect(computeBackoffMs(2, opts)).toBe(150);
    expect(computeBackoffMs(3, opts)).toBe(300);
    expect(computeBackoffMs(10, opts)).toBe(750);
    expect(computeBackoffMs(2, { ...opts, random: () => 0 })).toBe(100);
    expect(computeBackoffMs(2, { ...opts, random: () => 0.999 })).toBeLessThanOrEqual(200);
  });

  it("sleep rejects with AbortError when aborted", async () => {
    const controller = new AbortController();
    const p = sleep(1000, controller.signal);
    controller.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    const already = new AbortController();
    already.abort();
    await expect(sleep(10, already.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("withTimeout aborts after the delay and reports timedOut", async () => {
    const t = withTimeout(5);
    expect(t.timedOut()).toBe(false);
    await new Promise((r) => setTimeout(r, 15));
    expect(t.signal.aborted).toBe(true);
    expect(t.timedOut()).toBe(true);
    t.clear();
  });

  it("withTimeout follows the parent signal without flagging a timeout", () => {
    const parent = new AbortController();
    const t = withTimeout(10_000, parent.signal);
    parent.abort();
    expect(t.signal.aborted).toBe(true);
    expect(t.timedOut()).toBe(false);
    t.clear();
  });
});
