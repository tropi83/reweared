import { describe, expect, it } from "vitest";
import { AppError } from "@aiv/domain/models";
import { loadWorkerConfig } from "./config";
import { RetryLater } from "./run-job";
import { backoffFor } from "./workers";

const base = {
  DATABASE_URL: "postgres://aiv:x@postgres/aiv",
  REDIS_URL: "redis://redis:6379",
  S3_ENDPOINT: "http://seaweedfs:8333",
  S3_BUCKET: "aiv-images",
  S3_ACCESS_KEY_ID: "a",
  S3_SECRET_ACCESS_KEY: "b",
};
const noFiles = (): string => {
  throw new Error("no file");
};

describe("worker config", () => {
  it("requires the keys of the providers it uses, reads them from secret files and never echoes them", () => {
    expect(() => loadWorkerConfig(base, noFiles)).toThrow(/CLOUDFLARE_ACCOUNT_ID\/CLOUDFLARE_API_TOKEN[\s\S]*GEMINI_API_KEY/);
    const files: Record<string, string> = { "/run/secrets/cf": "cf-token-123\n", "/run/secrets/gemini": "AIzaFAKE0000\n" };
    const config = loadWorkerConfig(
      {
        ...base,
        CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
        CLOUDFLARE_API_TOKEN_FILE: "/run/secrets/cf",
        GEMINI_API_KEY_FILE: "/run/secrets/gemini",
      },
      (p) => files[p] ?? noFiles(),
    );
    expect(config.CLOUDFLARE_API_TOKEN).toBe("cf-token-123");
    expect(config.GEMINI_API_KEY).toBe("AIzaFAKE0000");
    let message = "";
    try {
      loadWorkerConfig({ ...base, CLOUDFLARE_ACCOUNT_ID: "not-an-account", CLOUDFLARE_API_TOKEN: "cf-secret-value", GEMINI_API_KEY: "x" }, noFiles);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("CLOUDFLARE_ACCOUNT_ID");
    expect(message).not.toContain("cf-secret-value");
  });

  it("runs the mock providers only when enabled, outside production", () => {
    const mock = { ...base, IMAGE_PROVIDER: "mock", COPY_PROVIDER: "mock" };
    expect(() => loadWorkerConfig({ ...mock, NODE_ENV: "development" }, noFiles)).toThrow(/ENABLE_MOCK_PROVIDER/);
    expect(loadWorkerConfig({ ...mock, NODE_ENV: "development", ENABLE_MOCK_PROVIDER: "true" }, noFiles).IMAGE_PROVIDER).toBe("mock");
    expect(() => loadWorkerConfig({ ...mock, ENABLE_MOCK_PROVIDER: "true" }, noFiles)).toThrow(/not allowed in production/);
  });
});

describe("backoffFor", () => {
  it("grows with attempts, stays under the cap and honours the provider's Retry-After", () => {
    const opts = { baseMs: 100, maxMs: 1_000 };
    for (let attempt = 1; attempt < 8; attempt++) expect(backoffFor(attempt, new Error("x"), opts)).toBeLessThanOrEqual(1_000);
    const limited = new RetryLater(new AppError("RATE_LIMITED", "slow down", { retryAfterMs: 5_000 }).toJSON());
    expect(backoffFor(1, limited, opts)).toBe(5_000);
  });
});
