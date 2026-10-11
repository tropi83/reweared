import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { AppError } from "@aiv/domain/models";
import { buildApp, type ReadinessCheck } from "./app";
import { HttpError } from "./http/errors";

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function makeApp(readiness: ReadinessCheck[] = []): Promise<FastifyInstance> {
  app = await buildApp({ logger: false, readiness });
  return app;
}

describe("health and readiness", () => {
  it("answers liveness without touching dependencies", async () => {
    const a = await makeApp([{ name: "db", check: () => Promise.reject(new Error("down")) }]);
    const res = await a.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("reports ready only when every dependency answers, naming the failing ones", async () => {
    const ok = await (await makeApp([{ name: "db", check: () => Promise.resolve() }])).inject({ method: "GET", url: "/api/v1/ready" });
    expect(ok.json()).toEqual({ status: "ready" });
    await app?.close();
    const down = await (
      await makeApp([
        { name: "db", check: () => Promise.resolve() },
        { name: "redis", check: () => Promise.reject(new Error("ECONNREFUSED redis://user:pw@redis")) },
      ])
    ).inject({ method: "GET", url: "/api/v1/ready" });
    expect(down.statusCode).toBe(503);
    expect(down.json()).toEqual({ status: "unavailable", failing: ["redis"] });
    expect(down.body).not.toContain("pw@");
  });
});

describe("error responses", () => {
  async function withRoutes(): Promise<FastifyInstance> {
    const a = await makeApp();
    a.get("/boom/http", async () => {
      throw new HttpError(404, "NOT_FOUND", "Listing not found.");
    });
    a.get("/boom/app", async () => {
      throw new AppError("INVALID_IMAGE", "The file is not an image.");
    });
    a.get("/boom/internal", async () => {
      throw new Error("db password is hunter2 at /srv/app/src/x.ts:12");
    });
    a.post("/echo", async (req) => req.body);
    return a;
  }

  it("maps known errors to their status and a { code, message } body", async () => {
    const a = await withRoutes();
    expect((await a.inject({ method: "GET", url: "/boom/http" })).json()).toEqual({ code: "NOT_FOUND", message: "Listing not found." });
    const appErr = await a.inject({ method: "GET", url: "/boom/app" });
    expect(appErr.statusCode).toBe(400);
    expect(appErr.json()).toEqual({ code: "INVALID_IMAGE", message: "The file is not an image." });
  });

  it("hides unexpected errors behind UNKNOWN_ERROR", async () => {
    const res = await (await withRoutes()).inject({ method: "GET", url: "/boom/internal" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ code: "UNKNOWN_ERROR", message: "Unexpected error." });
    expect(res.body).not.toContain("hunter2");
  });

  it("answers unknown routes and malformed JSON with our codes", async () => {
    const a = await withRoutes();
    expect((await a.inject({ method: "GET", url: "/nope" })).json()).toEqual({ code: "NOT_FOUND", message: "Not found." });
    const bad = await a.inject({ method: "POST", url: "/echo", headers: { "content-type": "application/json" }, payload: "{not json" });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().code).toBe("VALIDATION_FAILED");
  });
});
