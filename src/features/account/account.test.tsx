import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { __setServices, createServices } from "@/app/services";
import { takeResetPasswordLink, useAccountStore } from "@/app/stores/account-store";
import { stopLiveUpdates } from "@/app/live-updates";
import { createApi } from "@/infrastructure/api/createApi";
import type { FetchLike } from "@/infrastructure/api/ApiClient";
import { LayeredSecretStore, MemorySecretStore } from "@/infrastructure/auth/SecretStore";
import { IndexedDbStorage } from "@/infrastructure/storage/IndexedDbStorage";
import { accountErrorMessage } from "./account-errors";
import { AuthScreens } from "./AuthScreens";

const ME = { id: "u1", email: "alice@example.test", emailVerified: true, name: "" };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

interface Call {
  path: string;
  body: unknown;
  authorization: string | undefined;
}

/** A fake API answering like Better Auth + `/api/v1/me`, recording what the app sent. */
function fakeApi(handler: (path: string, body: unknown) => Response) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const path = url.replace("https://api.example.test", "");
    // The live-updates stream opened at sign-in: an empty stream, not part of what the tests look at.
    if (path === "/api/v1/events") return new Response("", { status: 200, headers: { "content-type": "text/event-stream" } });
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ path, body, authorization: (init?.headers as Record<string, string> | undefined)?.authorization });
    return handler(path, body);
  };
  return { fetch, calls };
}

function setup(handler: (path: string, body: unknown) => Response, tauri = true) {
  const { fetch, calls } = fakeApi(handler);
  const keychain = new MemorySecretStore();
  const secrets = new LayeredSecretStore(new MemorySecretStore(), keychain);
  __setServices(null);
  const api = createApi("https://api.example.test", secrets, { tauri, fetch });
  createServices({ storage: new IndexedDbStorage("account-test"), api });
  api.onUnauthenticated(() => useAccountStore.getState().sessionEnded());
  return { calls, keychain };
}

beforeEach(() => useAccountStore.setState({ status: "unknown", me: null }));
afterEach(() => stopLiveUpdates());

describe("account store", () => {
  it("signs in, keeps the token in the keychain, uses it and forgets it at sign-out", async () => {
    let signedIn = false;
    const { calls, keychain } = setup((path) => {
      if (path === "/api/auth/sign-in/email") return ((signedIn = true), json(200, { token: "t" }, { "set-auth-token": "session-token" }));
      if (path === "/api/v1/me") return signedIn ? json(200, ME) : json(401, { code: "UNAUTHENTICATED", message: "Sign in." });
      if (path === "/api/v1/listings") return json(200, []);
      if (path === "/api/auth/sign-out") return json(200, { success: true });
      return json(404, { code: "NOT_FOUND", message: "" });
    });
    await useAccountStore.getState().load();
    expect(useAccountStore.getState().status).toBe("signedOut");

    expect(await useAccountStore.getState().signIn("alice@example.test", "correct horse battery")).toBe("signedIn");
    expect(useAccountStore.getState()).toMatchObject({ status: "signedIn", me: ME });
    expect(await keychain.get("session_token")).toBe("session-token");
    expect(calls.filter((c) => c.path.startsWith("/api/v1/")).map((c) => [c.path, c.authorization])).toEqual([
      ["/api/v1/me", undefined],
      ["/api/v1/me", "Bearer session-token"],
      ["/api/v1/me/settings", "Bearer session-token"],
      ["/api/v1/listings", "Bearer session-token"],
    ]);

    await useAccountStore.getState().signOut();
    expect(useAccountStore.getState()).toMatchObject({ status: "signedOut", me: null });
    expect(await keychain.get("session_token")).toBeNull();
  });

  it("reports an unverified address as a sent verification link, not an error", async () => {
    setup(() => json(403, { code: "EMAIL_NOT_VERIFIED", message: "Email not verified" }));
    expect(await useAccountStore.getState().signIn("bob@example.test", "correct horse battery")).toBe("verificationSent");
  });

  it("sends the email links back to the web app", async () => {
    const { calls } = setup(() => json(200, { status: true }));
    await useAccountStore.getState().signUp("carol@example.test", "correct horse battery");
    await useAccountStore.getState().requestPasswordReset("carol@example.test");
    await useAccountStore.getState().resetPassword("reset-token", "another long password");
    await useAccountStore.getState().requestAccountDeletion();
    expect(calls.map((c) => [c.path, c.body])).toEqual([
      ["/api/auth/sign-up/email", { email: "carol@example.test", password: "correct horse battery", name: "", callbackURL: "/" }],
      ["/api/auth/request-password-reset", { email: "carol@example.test", redirectTo: "/#/reset-password" }],
      ["/api/auth/reset-password", { token: "reset-token", newPassword: "another long password" }],
      ["/api/auth/delete-user", { callbackURL: "/" }],
    ]);
  });

  it("signs out when the API answers 401 on any call", async () => {
    setup(
      (path) => (path === "/api/v1/me" ? json(200, ME) : path === "/api/v1/listings" ? json(200, []) : json(401, { code: "UNAUTHENTICATED", message: "" })),
      false,
    );
    await useAccountStore.getState().load();
    expect(useAccountStore.getState().status).toBe("signedIn");
    await expect(useAccountStore.getState().requestAccountDeletion()).rejects.toMatchObject({ status: 401 });
    expect(useAccountStore.getState().status).toBe("signedOut");
  });
});

describe("password-reset link", () => {
  it("reads the token or the error Better Auth appends", () => {
    expect(takeResetPasswordLink({ search: "?token=abc", hash: "#/reset-password" })).toEqual({ token: "abc" });
    expect(takeResetPasswordLink({ search: "?error=INVALID_TOKEN", hash: "#/reset-password" })).toEqual({ error: "INVALID_TOKEN" });
    expect(takeResetPasswordLink({ search: "?token=abc", hash: "#/" })).toBeNull();
  });
});

describe("account errors", () => {
  it("maps server codes to our wording and never shows the raw message", async () => {
    const { ApiError } = await import("@/infrastructure/api/ApiClient");
    expect(accountErrorMessage(new ApiError("INVALID_EMAIL_OR_PASSWORD", "raw", 401))).toBe("Wrong email or password.");
    expect(accountErrorMessage(new ApiError("UNKNOWN_ERROR", "Too many requests", 429))).toBe("Too many attempts. Wait a moment and try again.");
    expect(accountErrorMessage(new ApiError("SOMETHING_ELSE", "internal detail", 500))).toBe("Something went wrong. Try again.");
  });
});

describe("AuthScreens", () => {
  it("creates an account and asks to follow the emailed link", async () => {
    const { calls } = setup(() => json(200, { token: null }));
    const user = userEvent.setup();
    render(<AuthScreens />);
    await user.click(screen.getByRole("button", { name: "No account yet? Create one" }));
    await user.type(screen.getByLabelText("Email"), "dave@example.test");
    await user.type(screen.getByLabelText(/Password/), "correct horse battery");
    await user.click(screen.getByRole("button", { name: "Create the account" }));
    expect(await screen.findByText(/We sent a verification link to dave@example.test/)).toBeInTheDocument();
    expect(calls[0]?.path).toBe("/api/auth/sign-up/email");
  });

  it("shows a wrong password in our words", async () => {
    setup(() => json(401, { code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }));
    const user = userEvent.setup();
    render(<AuthScreens />);
    await user.type(screen.getByLabelText("Email"), "erin@example.test");
    await user.type(screen.getByLabelText("Password"), "not the password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wrong email or password.");
  });
});
