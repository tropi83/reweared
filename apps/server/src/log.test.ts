import { describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { pino } from "pino";
import { describeError, loggerOptions, pathOnly } from "./log";

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  return { log: pino(loggerOptions("info"), stream), lines };
}

describe("server logging", () => {
  it("strips query strings so verification and reset tokens never reach the logs", () => {
    expect(pathOnly("/api/auth/verify-email?token=abc.def&callbackURL=/")).toBe("/api/auth/verify-email");
    expect(pathOnly("/api/v1/listings#x")).toBe("/api/v1/listings");
    expect(pathOnly(undefined)).toBe("");
  });

  it("logs requests as method, path and IP only", () => {
    const { log, lines } = capture();
    log.info({ req: { method: "GET", url: "/api/auth/reset?token=s3cr3t", ip: "10.0.0.2", headers: { cookie: "better-auth.session_token=abc" } } }, "request");
    const entry = JSON.parse(lines[0]!);
    expect(entry.req).toEqual({ method: "GET", url: "/api/auth/reset", ip: "10.0.0.2" });
    expect(lines[0]).not.toContain("s3cr3t");
    expect(lines[0]).not.toContain("session_token=abc");
  });

  it("redacts credentials in messages and error messages", () => {
    const { log, lines } = capture();
    log.warn("resend refused re_FAKE0000000000000000000000");
    log.error({ err: new Error("auth failed with Bearer abc.def") }, "failure");
    expect(lines.join("")).not.toContain("re_FAKE");
    expect(lines.join("")).not.toContain("abc.def");
    expect(JSON.parse(lines[1]!).err).toEqual({ type: "Error", message: "auth failed with [REDACTED]" });
  });
});

describe("describeError", () => {
  it("follows the cause chain on one redacted line", () => {
    const driver = new Error('password authentication failed for user "aiv" (password=hunter22)');
    const wrapped = new Error('Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"\nparams: ', { cause: driver });
    // The redacted value runs to the next separator, ")" included: a password may contain ")" and must not leak its tail.
    expect(describeError(wrapped)).toBe(
      'Error: Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle" <- caused by Error: password authentication failed for user "aiv" (password=[REDACTED]',
    );
    expect(describeError("plain")).toBe("plain");
  });
});
