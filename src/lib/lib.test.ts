import { describe, expect, it } from "vitest";
import { assertSafeId, createId, SAFE_ID_PATTERN } from "./ids";
import { createLogger, getRecentLogs, redact } from "./logger";
import { computeBackoffMs, sleep, withTimeout } from "./retry";

describe("ids", () => {
  it("creates prefixed ids that pass the safety pattern", () => {
    for (const prefix of ["lst", "img", "gen", "job", "rcp"] as const) {
      const id = createId(prefix);
      expect(id.startsWith(`${prefix}_`)).toBe(true);
      expect(SAFE_ID_PATTERN.test(id)).toBe(true);
      expect(assertSafeId(id)).toBe(id);
    }
  });

  it("rejects anything that could escape a directory", () => {
    for (const bad of ["../x", "prj_../..", "prj_ABC", "prj_1234567", "img_00000000/../x", "", "prj_"]) {
      expect(() => assertSafeId(bad)).toThrow(/Invalid identifier/);
    }
  });
});

describe("logger redaction", () => {
  it("masks Google API keys, OAuth tokens and bearer headers", () => {
    const line = "key AIzaSyA1234567890abcdefghijklmnopqrstu token ya29.a0AfH6SMBxyz-_ refresh 1//0gabcdefghijklmnopqrstuvwxyz Bearer abc.def";
    const out = redact(line);
    expect(out).not.toContain("AIzaSy");
    expect(out).not.toContain("ya29.");
    expect(out).not.toContain("1//0g");
    expect(out).not.toMatch(/Bearer abc/);
    expect(out.match(/\[REDACTED\]/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("masks key=value and JSON credential fields while keeping the field name", () => {
    expect(redact('{"api_key":"secretvalue","x":1}')).toContain('"api_key":[REDACTED]');
    expect(redact("x-goog-api-key: something-long")).toBe("x-goog-api-key: [REDACTED]");
    expect(redact("refresh_token=abc123")).toBe("refresh_token=[REDACTED]");
  });

  it("stores redacted entries for diagnostics", () => {
    const log = createLogger("test");
    log.warn("token", "ya29.abcdefghijklmnop");
    const last = getRecentLogs().at(-1)!;
    expect(last.scope).toBe("test");
    expect(last.message).not.toContain("ya29.abc");
  });
});

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
