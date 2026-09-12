import { afterEach, describe, expect, it } from "vitest";
import { setLocale } from "./index";
import { errorMessage, formatDuration, nextMidnightIn } from "./errors";

describe("nextMidnightIn", () => {
  it("returns the next 00:00 UTC for Cloudflare", () => {
    const now = new Date("2026-09-12T21:30:00Z");
    expect(nextMidnightIn("UTC", now).toISOString()).toBe("2026-09-13T00:00:00.000Z");
  });

  it("returns the next midnight Pacific (PDT = UTC-7 in September) for Gemini", () => {
    const now = new Date("2026-09-12T21:30:00Z"); // 14:30 in Los Angeles
    expect(nextMidnightIn("America/Los_Angeles", now).toISOString()).toBe("2026-09-13T07:00:00.000Z");
    const late = new Date("2026-09-13T06:59:00Z"); // 23:59 the same Pacific day
    expect(nextMidnightIn("America/Los_Angeles", late).toISOString()).toBe("2026-09-13T07:00:00.000Z");
  });

  it("handles standard time (PST = UTC-8)", () => {
    const now = new Date("2026-01-10T12:00:00Z");
    expect(nextMidnightIn("America/Los_Angeles", now).toISOString()).toBe("2026-01-11T08:00:00.000Z");
  });
});

describe("formatDuration", () => {
  it("formats hours and minutes", () => {
    expect(formatDuration(12 * 60_000)).toBe("12 min");
    expect(formatDuration(5 * 3_600_000 + 20 * 60_000)).toBe("5 h 20 min");
    expect(formatDuration(3 * 3_600_000)).toBe("3 h");
    expect(formatDuration(10)).toBe("1 min");
  });
});

describe("errorMessage", () => {
  afterEach(() => setLocale("en"));

  it("uses the provider-specific wording and names the reset time for quota errors", () => {
    const now = new Date("2026-09-12T21:30:00Z");
    const cf = errorMessage({ code: "QUOTA_EXCEEDED" }, "cloudflare", now);
    expect(cf).toContain("Workers AI");
    expect(cf).toContain("00:00 UTC");
    expect(cf).toContain("in 2 h 30 min");
    expect(cf).not.toContain("Gemini");
    expect(cf).not.toMatch(/\{\w+\}/);

    const gm = errorMessage({ code: "QUOTA_EXCEEDED" }, "gemini", now);
    expect(gm).toContain("Gemini");
    expect(gm).toContain("Pacific");
    expect(gm).toContain("in 9 h 30 min");
  });

  it("falls back to the generic wording for unknown providers or codes without a specific text", () => {
    expect(errorMessage({ code: "QUOTA_EXCEEDED" }, "mock")).toBe(
      "The provider's daily quota is used up. Try again after it resets, or check your plan on the provider's dashboard.",
    );
    expect(errorMessage({ code: "NETWORK_ERROR" }, "cloudflare")).toBe("Network error. Check your connection and retry.");
    expect(errorMessage({ code: "TIMEOUT" })).toBe("The provider took too long to answer.");
  });

  it("is localized", () => {
    setLocale("fr");
    const cf = errorMessage({ code: "QUOTA_EXCEEDED" }, "cloudflare", new Date("2026-09-12T21:30:00Z"));
    expect(cf).toContain("neurones");
    expect(cf).toContain("dans 2 h 30 min");
  });
});
