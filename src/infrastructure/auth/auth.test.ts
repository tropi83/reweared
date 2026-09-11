import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __setFetchOverride } from "@/infrastructure/http/http-client";
import { ApiKeyCredentialProvider } from "./ApiKeyCredentialProvider";
import { GoogleOAuthCredentialProvider, type LoopbackListener } from "./GoogleOAuthCredentialProvider";
import { createCodeChallenge, createCodeVerifier, randomUrlSafeString } from "./pkce";
import { LayeredSecretStore, MemorySecretStore, WebLocalSecretStore } from "./SecretStore";

function layered() {
  return new LayeredSecretStore(new MemorySecretStore(), new WebLocalSecretStore());
}

beforeEach(() => localStorage.clear());
afterEach(() => __setFetchOverride(undefined));

describe("LayeredSecretStore", () => {
  it("keeps secrets in memory unless remember is requested", async () => {
    const store = layered();
    await store.set("gemini_api_key", "AIzaSyMEMORYONLY0000000000000000000", false);
    expect(await store.get("gemini_api_key")).toBe("AIzaSyMEMORYONLY0000000000000000000");
    expect(localStorage.length).toBe(0);
    expect(await store.isRemembered("gemini_api_key")).toBe(false);
  });

  it("persists when remembered and forgets on delete", async () => {
    const store = layered();
    await store.set("gemini_api_key", "AIzaSyPERSISTED00000000000000000000", true);
    expect(await store.isRemembered("gemini_api_key")).toBe(true);
    // A fresh layered store (new session) reads it back from the persistent tier.
    expect(await layered().get("gemini_api_key")).toBe("AIzaSyPERSISTED00000000000000000000");
    await store.delete("gemini_api_key");
    expect(await layered().get("gemini_api_key")).toBeNull();
  });

  it("removes a previously persisted value when re-saved without remember", async () => {
    const store = layered();
    await store.set("gemini_api_key", "AIzaSyFIRST000000000000000000000000", true);
    await store.set("gemini_api_key", "AIzaSySECOND00000000000000000000000", false);
    expect(await layered().get("gemini_api_key")).toBeNull();
    expect(await store.get("gemini_api_key")).toBe("AIzaSySECOND00000000000000000000000");
  });
});

describe("ApiKeyCredentialProvider", () => {
  it("validates, stores and exposes only a masked label", async () => {
    const provider = new ApiKeyCredentialProvider(layered());
    await expect(provider.authenticate({ apiKey: "short", remember: false })).rejects.toMatchObject({ code: "INVALID_CREDENTIAL" });
    await expect(provider.authenticate({ apiKey: "AIza with spaces inside the value 000", remember: false })).rejects.toMatchObject({
      code: "INVALID_CREDENTIAL",
    });
    const { status } = await provider.authenticate({ apiKey: "  AIzaSyVALIDLOOKINGKEY0000000000000000  ", remember: false });
    expect(status).toEqual({ state: "authenticated", kind: "api_key", label: "…0000" });
    expect(await provider.getRequestHeaders()).toEqual({ "x-goog-api-key": "AIzaSyVALIDLOOKINGKEY0000000000000000" });
  });

  it("reports AUTH_REQUIRED without a key and reflects rejections", async () => {
    const provider = new ApiKeyCredentialProvider(layered());
    await expect(provider.getRequestHeaders()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    expect((await provider.getStatus()).state).toBe("unauthenticated");
    await provider.authenticate({ apiKey: "AIzaSyVALIDLOOKINGKEY0000000000000000", remember: false });
    provider.markRejected();
    expect((await provider.getStatus()).state).toBe("invalid");
    await provider.revoke();
    expect((await provider.getStatus()).state).toBe("unauthenticated");
  });
});

describe("pkce", () => {
  it("produces RFC 7636 compliant verifiers and S256 challenges", async () => {
    const verifier = createCodeVerifier();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    const challenge = await createCodeChallenge(verifier);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await createCodeChallenge(verifier)).toBe(challenge);
    expect(randomUrlSafeString(16)).not.toBe(randomUrlSafeString(16));
  });
});

describe("GoogleOAuthCredentialProvider", () => {
  const config = { clientId: "client-id.apps.googleusercontent.com", clientSecret: "public-desktop-secret" };

  function makeLoopback(result: { code?: string; state?: string; error?: string } | ((state: string) => { code?: string; state?: string; error?: string })) {
    let capturedState = "";
    const listener: LoopbackListener = {
      start: async () => ({ port: 43210 }),
      waitForCallback: async () => (typeof result === "function" ? result(capturedState) : result),
      cancel: vi.fn(async () => undefined),
    };
    return {
      listener,
      openBrowser: async (url: string) => {
        capturedState = new URL(url).searchParams.get("state") ?? "";
        (listener as { lastUrl?: string }).lastUrl = url;
      },
    };
  }

  function stubGoogle(tokens: Record<string, unknown>) {
    const calls: Array<{ url: string; body: string }> = [];
    __setFetchOverride(async (url, init) => {
      calls.push({ url, body: String(init?.body ?? "") });
      if (url.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify(tokens), { status: 200 });
      if (url.startsWith("https://www.googleapis.com/oauth2/v3/userinfo")) return new Response(JSON.stringify({ email: "user@example.com" }), { status: 200 });
      if (url.startsWith("https://oauth2.googleapis.com/revoke")) return new Response("", { status: 200 });
      if (url.startsWith("https://cloudresourcemanager.googleapis.com/")) {
        return new Response(JSON.stringify({ projects: [{ projectId: "my-proj-123", name: "My project" }] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });
    return calls;
  }

  it("runs the PKCE + loopback flow and produces bearer headers with the quota project", async () => {
    vi.spyOn(await import("@/infrastructure/platform/capabilities"), "getPlatform").mockReturnValue({
      kind: "windows",
      isTauri: true,
      isMobile: false,
      filesystem: true,
      secureStorage: true,
      oauthBrowserFlow: true,
      nativeShare: false,
      camera: false,
      nativeDialogs: true,
    });
    const calls = stubGoogle({ access_token: "ya29.access", refresh_token: "1//refresh", expires_in: 3600 });
    const { listener, openBrowser } = makeLoopback((state) => ({ code: "4/auth-code", state }));
    const secrets = layered();
    const provider = new GoogleOAuthCredentialProvider(secrets, config, listener, openBrowser);
    expect(provider.isConfigured).toBe(true);

    const { status } = await provider.authenticate();
    expect(status).toMatchObject({ state: "authenticated", kind: "oauth", label: "user@example.com" });

    const authUrl = new URL((listener as { lastUrl?: string }).lastUrl!);
    expect(authUrl.origin + authUrl.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(authUrl.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:43210/callback");
    expect(authUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authUrl.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/cloud-platform");

    const tokenCall = calls.find((c) => c.url.includes("/token"))!;
    const body = new URLSearchParams(tokenCall.body);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("4/auth-code");
    expect(body.get("code_verifier")).toBeTruthy();

    await provider.setProjectId("my-proj-123");
    expect(await provider.getRequestHeaders()).toEqual({ Authorization: "Bearer ya29.access", "x-goog-user-project": "my-proj-123" });
    await expect(provider.setProjectId("Not A Valid Id!")).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(await provider.listProjects()).toEqual([{ projectId: "my-proj-123", name: "My project" }]);
    expect(listener.cancel).toHaveBeenCalledWith(43210);

    // Tokens went to the persistent tier only because the platform reports secure storage.
    expect(JSON.parse(localStorage.getItem("aiv.secret.google_oauth")!)).toMatchObject({ refreshToken: "1//refresh" });

    await provider.revoke();
    expect((await provider.getStatus()).state).toBe("unauthenticated");
    expect(calls.some((c) => c.url.startsWith("https://oauth2.googleapis.com/revoke"))).toBe(true);
    vi.restoreAllMocks();
  });

  it("rejects a callback whose state does not match", async () => {
    vi.spyOn(await import("@/infrastructure/platform/capabilities"), "getPlatform").mockReturnValue({
      kind: "windows",
      isTauri: true,
      isMobile: false,
      filesystem: true,
      secureStorage: true,
      oauthBrowserFlow: true,
      nativeShare: false,
      camera: false,
      nativeDialogs: true,
    });
    stubGoogle({});
    const { listener, openBrowser } = makeLoopback({ code: "x", state: "forged" });
    const provider = new GoogleOAuthCredentialProvider(layered(), config, listener, openBrowser);
    await expect(provider.authenticate()).rejects.toMatchObject({ code: "INVALID_CREDENTIAL" });
    vi.restoreAllMocks();
  });

  it("maps a user denial to CANCELLED and refuses to run when unconfigured", async () => {
    vi.spyOn(await import("@/infrastructure/platform/capabilities"), "getPlatform").mockReturnValue({
      kind: "windows",
      isTauri: true,
      isMobile: false,
      filesystem: true,
      secureStorage: true,
      oauthBrowserFlow: true,
      nativeShare: false,
      camera: false,
      nativeDialogs: true,
    });
    const { listener, openBrowser } = makeLoopback({ error: "access_denied" });
    await expect(new GoogleOAuthCredentialProvider(layered(), config, listener, openBrowser).authenticate()).rejects.toMatchObject({ code: "CANCELLED" });
    await expect(new GoogleOAuthCredentialProvider(layered(), null, listener, openBrowser).authenticate()).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    vi.restoreAllMocks();
  });

  it("refreshes an expired access token once, even under concurrent requests", async () => {
    const calls = stubGoogle({ access_token: "ya29.fresh", expires_in: 3600 });
    const secrets = layered();
    await secrets.set("google_oauth", JSON.stringify({ refreshToken: "1//r", accessToken: "ya29.old", expiresAt: Date.now() - 1000 }), false);
    const provider = new GoogleOAuthCredentialProvider(secrets, config, null, async () => undefined);
    const [a, b] = await Promise.all([provider.getRequestHeaders(), provider.getRequestHeaders()]);
    expect(a.Authorization).toBe("Bearer ya29.fresh");
    expect(b.Authorization).toBe("Bearer ya29.fresh");
    expect(calls.filter((c) => c.url.includes("/token"))).toHaveLength(1);
    expect(new URLSearchParams(calls[0]!.body).get("grant_type")).toBe("refresh_token");
  });

  it("drops the session when Google reports invalid_grant", async () => {
    __setFetchOverride(async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }));
    const secrets = layered();
    await secrets.set("google_oauth", JSON.stringify({ refreshToken: "1//r", accessToken: "ya29.old", expiresAt: 0 }), false);
    const provider = new GoogleOAuthCredentialProvider(secrets, config, null, async () => undefined);
    await expect(provider.getRequestHeaders()).rejects.toMatchObject({ code: "AUTH_EXPIRED" });
    expect((await provider.getStatus()).state).toBe("unauthenticated");
  });
});
