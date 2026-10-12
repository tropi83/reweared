import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { MemorySecretStore } from "@/infrastructure/auth/SecretStore";
import { ApiClient, ApiError, type FetchLike } from "./ApiClient";
import { SessionTokenStore } from "./session";
import { createSseParser, runEventStream } from "./sse";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("ApiClient", () => {
  it("sends cookies on the web and the bearer token in the apps, to its origin only", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetch: FetchLike = async (url, init) => (calls.push({ url, init }), json(200, { ok: true }));
    await new ApiClient({ origin: "/", fetch, bearer: async () => null }).get("/api/v1/me");
    await new ApiClient({ origin: "https://app.example.test/", fetch, bearer: async () => "tok" }).get("/api/v1/me");
    expect(calls[0]).toMatchObject({ url: "/api/v1/me", init: { credentials: "include" } });
    expect(calls[1]).toMatchObject({ url: "https://app.example.test/api/v1/me", init: { credentials: "omit", headers: { authorization: "Bearer tok" } } });
    expect(() => new ApiClient({ origin: "/", fetch, bearer: async () => null }).url("https://evil.example/x")).toThrow();
  });

  it("parses responses with the contract and maps error bodies to ApiError", async () => {
    const schema = z.object({ id: z.string() });
    const ok = new ApiClient({ origin: "/", fetch: async () => json(200, { id: "x" }), bearer: async () => null });
    expect(await ok.get("/api/v1/me", schema)).toEqual({ id: "x" });
    const onUnauthenticated = vi.fn();
    const refused = new ApiClient({
      origin: "/",
      fetch: async () => json(401, { code: "UNAUTHENTICATED", message: "Sign in to continue." }),
      bearer: async () => null,
      onUnauthenticated,
    });
    await expect(refused.get("/api/v1/me")).rejects.toMatchObject({ code: "UNAUTHENTICATED", status: 401 });
    expect(onUnauthenticated).toHaveBeenCalledOnce();
    const broken = new ApiClient({ origin: "/", fetch: async () => new Response("<html>", { status: 502 }), bearer: async () => null });
    await expect(broken.get("/api/v1/me")).rejects.toMatchObject({ code: "UNKNOWN_ERROR", status: 502 });
    const offline = new ApiClient({ origin: "/", fetch: async () => Promise.reject(new TypeError("Failed to fetch")), bearer: async () => null });
    await expect(offline.get("/api/v1/me")).rejects.toBeInstanceOf(ApiError);
  });

  it("hands the session token returned at sign-in to the keychain", async () => {
    const store = new SessionTokenStore(new MemorySecretStore(), true);
    const client = new ApiClient({
      origin: "/",
      fetch: async () => json(200, {}, { "set-auth-token": "new-token" }),
      bearer: () => store.get(),
      onSessionToken: (t) => store.set(t),
    });
    await client.request("POST", "/api/auth/sign-in/email", { json: {} });
    expect(await store.get()).toBe("new-token");
    await store.clear();
    expect(await store.get()).toBeNull();
    expect(await new SessionTokenStore(new MemorySecretStore(), false).get()).toBeNull();
  });
});

describe("server-sent events", () => {
  it("parses events split across chunks, skipping comments and malformed data", () => {
    const events: unknown[] = [];
    const feed = createSseParser((e) => events.push(e));
    feed('retry: 3000\n\n: ping\n\nid: 1-0\nevent: message\ndata: {"type":"job",');
    feed('"jobId":"a"}\n\nid: 2-0\ndata: not json\n\nid: 3-0\r\ndata: {"type":"listing"}\r\n\r\n');
    expect(events).toEqual([
      { id: "1-0", data: { type: "job", jobId: "a" } },
      { id: "3-0", data: { type: "listing" } },
    ]);
  });

  it("reconnects after a drop and resumes from the last event id", async () => {
    const seen: string[] = [];
    const sentIds: Array<string | undefined> = [];
    const controller = new AbortController();
    let call = 0;
    const fetch: FetchLike = async (_url, init) => {
      sentIds.push((init?.headers as Record<string, string>)["last-event-id"]);
      call++;
      const body = call === 1 ? 'id: 5-0\ndata: {"n":1}\n\n' : 'id: 6-0\ndata: {"n":2}\n\n';
      if (call >= 2) setTimeout(() => controller.abort(), 20);
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    };
    await runEventStream({ url: "/api/v1/events", fetch, headers: async () => ({}), onEvent: (e) => seen.push(e.id), signal: controller.signal, retryMs: 5 });
    expect(seen.slice(0, 2)).toEqual(["5-0", "6-0"]);
    expect(sentIds.slice(0, 2)).toEqual([undefined, "5-0"]);
  });
});
