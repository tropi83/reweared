import { describe, expect, it } from "vitest";
import { createLogger, getRecentLogs } from "./logger";

describe("logger redaction", () => {
  it("stores redacted entries for diagnostics", () => {
    const log = createLogger("test");
    log.warn("token", "ya29.abcdefghijklmnop");
    const last = getRecentLogs().at(-1)!;
    expect(last.scope).toBe("test");
    expect(last.message).not.toContain("ya29.abc");
  });
});
