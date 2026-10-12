import { create } from "zustand";
import type { z } from "zod";
import { meDto } from "@aiv/contracts/me";
import { ApiError } from "@/infrastructure/api/ApiClient";
import { getQueryClient } from "../query/query-client";
import { getServices } from "../services";
import { useListingsStore } from "./listings-store";
import { createLogger } from "@/lib/logger";

const log = createLogger("account");

export type Me = z.infer<typeof meDto>;

/** Where an email link sends the user back: the web app, on the API's public origin (Better Auth resolves it). */
export const AUTH_CALLBACK = "/";
export const RESET_PASSWORD_CALLBACK = "/#/reset-password";

interface AccountState {
  /** `unknown` until the first `GET /api/v1/me` answered. */
  status: "unknown" | "signedOut" | "signedIn";
  me: Me | null;
  load(): Promise<void>;
  /** Creates the account; the server emails a verification link and opens no session until it is followed. */
  signUp(email: string, password: string): Promise<void>;
  /** `verificationSent`: the address is not verified yet, the server sent the link again. */
  signIn(email: string, password: string): Promise<"signedIn" | "verificationSent">;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  resetPassword(token: string, newPassword: string): Promise<void>;
  /** Emails a confirmation link; the account is deleted only when it is followed. */
  requestAccountDeletion(): Promise<void>;
  /** The API answered 401: the session ended elsewhere (expired, revoked, password reset). */
  sessionEnded(): void;
}

function api() {
  const api = getServices().api;
  if (!api) throw new Error("The account features need VITE_API_ORIGIN");
  return api;
}

export const useAccountStore = create<AccountState>((set, get) => ({
  status: "unknown",
  me: null,

  async load() {
    let me: Me;
    try {
      me = await api().client.get("/api/v1/me", meDto);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return get().sessionEnded();
      // Offline or server down: keep a known session, otherwise show the sign-in screen with the error.
      if (get().status === "unknown") set({ status: "signedOut" });
      throw error;
    }
    const wasSignedIn = get().status === "signedIn";
    set({ status: "signedIn", me });
    // The account's listings for the sidebar; a failure leaves it empty and the session stands.
    if (!wasSignedIn)
      await useListingsStore
        .getState()
        .loadSummaries()
        .catch((error: unknown) => log.warn("listings not loaded", error));
  },

  async signUp(email, password) {
    // Better Auth requires a name; the app has no use for one.
    await api().client.request("POST", "/api/auth/sign-up/email", { json: { email, password, name: "", callbackURL: AUTH_CALLBACK } });
  },

  async signIn(email, password) {
    try {
      await api().client.request("POST", "/api/auth/sign-in/email", { json: { email, password, callbackURL: AUTH_CALLBACK } });
    } catch (error) {
      if (error instanceof ApiError && error.code === "EMAIL_NOT_VERIFIED") return "verificationSent";
      throw error;
    }
    await get().load();
    return "signedIn";
  },

  async signOut() {
    const { client, session } = api();
    try {
      await client.request("POST", "/api/auth/sign-out", { json: {} });
    } finally {
      // Signed out locally even when the server cannot be reached: the token leaves the keychain either way.
      await session.clear();
      forgetUserData();
      set({ status: "signedOut", me: null });
    }
  },

  async requestPasswordReset(email) {
    await api().client.request("POST", "/api/auth/request-password-reset", { json: { email, redirectTo: RESET_PASSWORD_CALLBACK } });
  },

  async resetPassword(token, newPassword) {
    await api().client.request("POST", "/api/auth/reset-password", { json: { token, newPassword } });
  },

  async requestAccountDeletion() {
    await api().client.request("POST", "/api/auth/delete-user", { json: { callbackURL: AUTH_CALLBACK } });
  },

  sessionEnded() {
    if (get().status === "signedOut") return;
    void getServices().api?.session.clear();
    forgetUserData();
    set({ status: "signedOut", me: null });
  },
}));

/** Nothing of the previous account stays on screen or in caches after a sign-out. */
function forgetUserData() {
  getQueryClient().clear();
  useListingsStore.setState({ summaries: [], current: null });
}

/**
 * The password-reset link lands on `/?token=…#/reset-password` (or `?error=INVALID_TOKEN`). Returns what it carries
 * and removes it from the address bar so the token does not stay in the history.
 */
export function takeResetPasswordLink(loc: Pick<Location, "search" | "hash"> = location): { token: string } | { error: string } | null {
  if (!loc.hash.startsWith("#/reset-password")) return null;
  const params = new URLSearchParams(loc.search);
  const token = params.get("token");
  const error = params.get("error");
  if (typeof history !== "undefined" && loc === location) history.replaceState(null, "", `${location.pathname}#/`);
  if (token) return { token };
  return { error: error ?? "INVALID_TOKEN" };
}
