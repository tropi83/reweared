import { describe, expect, it } from "vitest";
import { redact } from "./redact";

describe("redact", () => {
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

  it("masks server-side secrets: Resend keys, session cookies, bearer tokens, S3 keys, passwords", () => {
    expect(redact("resend re_FAKE0000000000000000000000 failed")).toBe("resend [REDACTED] failed");
    expect(redact("cookie: better-auth.session_token=abc.def123; theme=dark")).toBe("cookie: better-auth.session_token=[REDACTED]; theme=dark");
    expect(redact("__Secure-better-auth.session_token=xyz%2Fabc")).toBe("__Secure-better-auth.session_token=[REDACTED]");
    expect(redact("set-auth-token: tok_123")).toBe("set-auth-token: [REDACTED]");
    expect(redact("Bearer abc/def+ghi==")).toBe("[REDACTED]");
    expect(redact("aws_secret_access_key=wJalrXUtnFEMI")).toBe("aws_secret_access_key=[REDACTED]");
    expect(redact('{"password":"hunter22"}')).toBe('{"password":[REDACTED]}');
  });

  it("leaves ordinary text alone", () => {
    const text = "store_and_restore_listing_cover_image failed for lst_0123abcd (theme=dark)";
    expect(redact(text)).toBe(text);
  });
});
