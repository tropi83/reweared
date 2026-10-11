import { describe, expect, it, vi } from "vitest";
import { midnightBefore, pacificMidnightBefore, quotaDayStart, UsageTracker } from "./usage-tracker";

describe("quotaDayStart", () => {
  it("uses 00:00 UTC for Cloudflare and Pacific midnight for Gemini", () => {
    const now = Date.parse("2026-09-11T22:30:00Z");
    expect(new Date(quotaDayStart("cloudflare", now)).toISOString()).toBe("2026-09-11T00:00:00.000Z");
    expect(new Date(quotaDayStart("gemini", now)).toISOString()).toBe("2026-09-11T07:00:00.000Z");
    expect(new Date(midnightBefore(Date.parse("2026-09-11T00:00:30Z"), "UTC")).toISOString()).toBe("2026-09-11T00:00:00.000Z");
  });
});

describe("pacificMidnightBefore", () => {
  it("returns the previous midnight in America/Los_Angeles", () => {
    // 2026-09-11T10:30:00Z = 03:30 PDT → midnight PDT = 07:00Z the same day
    const now = Date.parse("2026-09-11T10:30:00Z");
    expect(new Date(pacificMidnightBefore(now)).toISOString()).toBe("2026-09-11T07:00:00.000Z");
    // 2026-09-11T05:00:00Z = 22:00 PDT on the 10th → midnight = 2026-09-10T07:00Z
    expect(new Date(pacificMidnightBefore(Date.parse("2026-09-11T05:00:00Z"))).toISOString()).toBe("2026-09-10T07:00:00.000Z");
  });
});

describe("UsageTracker", () => {
  function make(start = Date.parse("2026-09-11T12:00:00Z")) {
    let now = start;
    const persisted: unknown[] = [];
    const tracker = new UsageTracker(
      async (r) => void persisted.push(r),
      () => now,
    );
    return { tracker, persisted, advance: (ms: number) => (now += ms) };
  }

  it("counts rolling-minute and Pacific-day windows per model", () => {
    const { tracker, advance } = make();
    tracker.track({ provider: "gemini", model: "a", outcome: "ok", tokens: 100 });
    tracker.track({ provider: "gemini", model: "a", outcome: "ok", tokens: 50 });
    tracker.track({ provider: "gemini", model: "b", outcome: "ok" });
    let s = tracker.snapshot("gemini", "a");
    expect(s.minute.used).toBe(2);
    expect(s.day.used).toBe(2);
    expect(s.tokensToday).toBe(150);
    expect(s.minute.limit).toBeUndefined();
    advance(61_000);
    s = tracker.snapshot("gemini", "a");
    expect(s.minute.used).toBe(0);
    expect(s.day.used).toBe(2);
    expect(tracker.snapshot("gemini", "b").day.used).toBe(1);
    expect(tracker.snapshot("mock", "a").day.used).toBe(0);
  });

  it("resets the day counter after Pacific midnight and counts throttling", () => {
    const { tracker, advance } = make(Date.parse("2026-09-11T06:30:00Z")); // 23:30 PDT (10th)
    tracker.track({ provider: "gemini", model: "a", outcome: "rate_limited" });
    tracker.track({ provider: "gemini", model: "a", outcome: "quota" });
    expect(tracker.snapshot("gemini", "a").throttledToday).toBe(2);
    advance(60 * 60_000); // 00:30 PDT (11th)
    expect(tracker.snapshot("gemini", "a").day.used).toBe(0);
  });

  it("learns limits from Google but never overrides manual ones", () => {
    const { tracker } = make();
    tracker.learnLimit("gemini", "a", "day", 100);
    tracker.learnLimit("gemini", "a", "minute", 10);
    expect(tracker.getLimit("gemini", "a")).toMatchObject({ perDay: 100, perMinute: 10, source: "learned" });
    for (let i = 0; i < 8; i++) tracker.track({ provider: "gemini", model: "a", outcome: "ok" });
    const s = tracker.snapshot("gemini", "a");
    expect(s.minute.ratio).toBeCloseTo(0.8);
    expect(s.day.ratio).toBeCloseTo(0.08);
    tracker.setManualLimit("gemini", "a", { perDay: 500 });
    tracker.learnLimit("gemini", "a", "day", 100);
    expect(tracker.getLimit("gemini", "a")).toMatchObject({ perDay: 500, source: "manual" });
    expect(tracker.getLimit("gemini", "a")?.perMinute).toBeUndefined();
    tracker.learnLimit("gemini", "a", "day", -5);
    expect(tracker.getLimit("gemini", "a")?.perDay).toBe(500);
  });

  it("treats a limit of 0 as fully used", () => {
    const { tracker } = make();
    tracker.learnLimit("gemini", "a", "day", 0);
    expect(tracker.snapshot("gemini", "a").day).toMatchObject({ used: 0, limit: 0, ratio: 1 });
  });

  it("persists (debounced) and reloads, pruning old events", async () => {
    vi.useFakeTimers();
    const { tracker, persisted, advance } = make();
    tracker.track({ provider: "gemini", model: "a", outcome: "ok" });
    tracker.learnLimit("gemini", "a", "day", 100);
    vi.advanceTimersByTime(400);
    await Promise.resolve();
    expect(persisted).toHaveLength(1);
    const record = tracker.toJSON();
    advance(72 * 60 * 60 * 1000);
    const fresh = new UsageTracker(
      async () => undefined,
      () => Date.parse("2026-09-14T12:00:00Z"),
    );
    fresh.load(record);
    expect(fresh.snapshot("gemini", "a").day.used).toBe(0);
    expect(fresh.getLimit("gemini", "a")?.perDay).toBe(100);
    expect(fresh.knownModels()).toEqual([{ provider: "gemini", model: "a" }]);
    fresh.load({ schemaVersion: 99 as 1, events: "nope" as unknown as [], limits: {} });
    expect(fresh.knownModels()).toEqual([{ provider: "gemini", model: "a" }]);
    fresh.reset();
    expect(fresh.knownModels()).toEqual([]);
    vi.useRealTimers();
  });
});
