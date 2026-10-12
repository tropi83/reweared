import { describe, expect, it } from "vitest";
import { createLogger, getRecentLogs, redact } from "./logger";

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
