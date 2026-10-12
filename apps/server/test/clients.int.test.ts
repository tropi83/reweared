import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PASSWORD, startHarness, verifiedUser, type Harness } from "./app-harness";

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(() => h.close());
beforeEach(() => h.reset());

const TAURI = "tauri://localhost";

describe("desktop and phone apps (CORS)", () => {
  it("answers the preflight of the Tauri origin and refuses other origins", async () => {
    const ok = await h.app.inject({
      method: "OPTIONS",
      url: "/api/v1/listings",
      headers: { origin: TAURI, "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" },
    });
    expect(ok.statusCode).toBe(204);
    expect(ok.headers["access-control-allow-origin"]).toBe(TAURI);
    expect(String(ok.headers["access-control-allow-headers"])).toContain("authorization");
    expect(ok.headers["access-control-allow-credentials"]).toBeUndefined();

    const evil = await h.app.inject({
      method: "OPTIONS",
      url: "/api/v1/listings",
      headers: { origin: "https://evil.example", "access-control-request-method": "POST" },
    });
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("lets the Tauri app sign in and read the session token header", async () => {
    await verifiedUser(h, "alice@example.test");
    const res = await h.app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { origin: TAURI, "x-forwarded-for": "203.0.113.9" },
      remoteAddress: "10.0.0.2",
      payload: { email: "alice@example.test", password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe(TAURI);
    expect(String(res.headers["access-control-expose-headers"])).toContain("set-auth-token");
    expect(typeof res.headers["set-auth-token"]).toBe("string");
  });
});

describe("GET /api/v1/platform", () => {
  it("publishes run costs, the free credits and the image model's choices", async () => {
    const res = await h.app.inject({ method: "GET", url: "/api/v1/platform" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      runCost: { image: 1, copy: 1 },
      freeMonthlyCredits: 60,
      imageModel: { aspectRatios: expect.arrayContaining(["original", "1:1"]) },
    });
  });
});
