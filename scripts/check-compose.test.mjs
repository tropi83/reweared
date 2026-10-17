// @vitest-environment node
import { describe, expect, it } from "vitest";
import { checkCompose } from "./check-compose.mjs";

const logging = { driver: "json-file", options: { "max-size": "10m", "max-file": "5" } };
const base = (extra = {}) => ({ image: "postgres:17.11-alpine3.24", logging, mem_limit: 1024, environment: {}, ...extra });

/** A compliant production config; each test breaks one thing. */
const good = () => ({
  services: {
    postgres: base(),
    api: base({ image: "ghcr.io/tropi83/aiv-server:0.2.0" }),
    worker: base({ image: "ghcr.io/tropi83/aiv-server:0.2.0", secrets: [{ source: "cloudflare_api_token" }, { source: "gemini_api_key" }] }),
    caddy: base({ image: "ghcr.io/tropi83/aiv-web:0.2.0", ports: [{ published: "443" }] }),
  },
});

describe("checkCompose", () => {
  it("accepts a compliant production config", () => {
    expect(checkCompose(good())).toEqual([]);
  });

  it("refuses unpinned images", () => {
    for (const image of ["redis", "redis:latest", "aiv-server:local"]) {
      const c = good();
      c.services.postgres.image = image;
      expect(checkCompose(c).join("\n")).toMatch(/postgres image/);
    }
    const c = good();
    c.services.postgres.image = "redis@sha256:abc";
    expect(checkCompose(c)).toEqual([]);
  });

  it("refuses a service without log rotation or a memory limit", () => {
    const c = good();
    delete c.services.api.logging;
    delete c.services.postgres.mem_limit;
    const problems = checkCompose(c).join("\n");
    expect(problems).toMatch(/api has no log rotation/);
    expect(problems).toMatch(/postgres has no memory limit/);
  });

  it("refuses the Mock provider in production", () => {
    const c = good();
    c.services.api.environment = { ENABLE_MOCK_PROVIDER: "true" };
    expect(checkCompose(c).join("\n")).toMatch(/api enables the Mock provider/);
  });

  it("keeps provider keys on the worker and ports on Caddy", () => {
    const c = good();
    c.services.api.secrets = [{ source: "gemini_api_key" }];
    c.services.api.environment = { CLOUDFLARE_API_TOKEN_FILE: "/x" };
    c.services.postgres.ports = [{ published: "5432" }];
    delete c.services.worker.secrets;
    const problems = checkCompose(c).join("\n");
    expect(problems).toMatch(/api receives the provider secret gemini_api_key/);
    expect(problems).toMatch(/api has the provider variable/);
    expect(problems).toMatch(/postgres publishes ports/);
    expect(problems).toMatch(/the worker lacks cloudflare_api_token/);
  });
});
