import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config";

const base = {
  PUBLIC_ORIGIN: "https://app.example.test",
  DATABASE_URL: "postgres://aiv:dev@postgres:5432/aiv",
  REDIS_URL: "redis://redis:6379",
  S3_ENDPOINT: "http://seaweedfs:8333",
  S3_BUCKET: "aiv-images",
  S3_ACCESS_KEY_ID: "dev-access",
  S3_SECRET_ACCESS_KEY: "dev-secret-value",
  BETTER_AUTH_SECRET: "x".repeat(32),
  MAIL_MODE: "memory",
  MAIL_FROM: "AI Image Variations <no-reply@example.test>",
};
const noFiles = () => {
  throw new Error("no file");
};

describe("loadConfig", () => {
  it("applies defaults and coerces numbers", () => {
    const config = loadConfig({ ...base, PORT: "8080" }, noFiles);
    expect(config.PORT).toBe(8080);
    expect(config.NODE_ENV).toBe("production");
    expect(config.MAX_UPLOAD_BYTES).toBe(40 * 1024 * 1024);
    expect(config.S3_REGION).toBe("us-east-1");
  });

  it("reads secrets from *_FILE, which wins over the plain variable, and trims the trailing newline", () => {
    const files: Record<string, string> = { "/run/secrets/db_url": "postgres://from-file\n", "/run/secrets/auth": `${"s".repeat(40)}\n` };
    const config = loadConfig(
      { ...base, DATABASE_URL_FILE: "/run/secrets/db_url", BETTER_AUTH_SECRET_FILE: "/run/secrets/auth" },
      (path) => files[path] ?? noFiles(),
    );
    expect(config.DATABASE_URL).toBe("postgres://from-file");
    expect(config.BETTER_AUTH_SECRET).toBe("s".repeat(40));
  });

  it("lists every problem by variable name and never echoes a value", () => {
    const secret = "postgres://user:sup3r-s3cret@db/aiv";
    let error: unknown;
    try {
      loadConfig(
        { ...base, DATABASE_URL: secret, BETTER_AUTH_SECRET: "short", S3_ENDPOINT: "not a url", MAIL_MODE: "resend", PUBLIC_ORIGIN: undefined },
        noFiles,
      );
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as ConfigError).message;
    expect(message).toContain("BETTER_AUTH_SECRET");
    expect(message).toContain("S3_ENDPOINT");
    expect(message).toContain("RESEND_API_KEY");
    expect(message).toContain("PUBLIC_ORIGIN");
    expect(message).not.toContain("short");
    expect(message).not.toContain("sup3r-s3cret");
  });

  it("reports an unreadable secret file without its contents or path being trusted", () => {
    expect(() => loadConfig({ ...base, S3_SECRET_ACCESS_KEY_FILE: "/missing" }, noFiles)).toThrow(/S3_SECRET_ACCESS_KEY_FILE: cannot read the secret file/);
  });

  it("requires Google client id and secret together, and SMTP_URL in smtp mode", () => {
    expect(() => loadConfig({ ...base, GOOGLE_CLIENT_ID: "id.apps.googleusercontent.com" }, noFiles)).toThrow(/GOOGLE_CLIENT_ID/);
    expect(() => loadConfig({ ...base, MAIL_MODE: "smtp" }, noFiles)).toThrow(/SMTP_URL/);
    expect(loadConfig({ ...base, MAIL_MODE: "smtp", SMTP_URL: "smtp://mailpit:1025" }, noFiles).SMTP_URL).toBe("smtp://mailpit:1025");
  });
});
