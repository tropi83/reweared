import { create } from "zustand";
import { toGenerationError, type AuthStatus, type CredentialKind, type GenerationError } from "@/domain/models";
import type { GoogleCloudProject } from "@/infrastructure/auth/GoogleOAuthCredentialProvider";
import { queryKeys } from "../query/keys";
import { getQueryClient } from "../query/query-client";
import { getServices } from "../services";

interface AuthState {
  /** Gemini's active credential status (kept for the Gemini settings card). */
  status: AuthStatus;
  cloudflareRemembered: boolean;
  apiKeyStatus: AuthStatus;
  oauthStatus: AuthStatus;
  apiKeyRemembered: boolean;
  busy: boolean;
  lastError: GenerationError | null;
  refresh(): Promise<void>;
  setActiveKind(kind: CredentialKind): Promise<void>;
  saveApiKey(apiKey: string, remember: boolean): Promise<void>;
  removeApiKey(): Promise<void>;
  testConnection(): Promise<boolean>;
  signInWithGoogle(signal?: AbortSignal): Promise<void>;
  signOutGoogle(): Promise<void>;
  setProjectId(projectId: string | undefined): Promise<void>;
  listProjects(): Promise<GoogleCloudProject[]>;
  saveCloudflareDirect(accountId: string, apiToken: string, remember: boolean): Promise<void>;
  saveCloudflareWorker(workerUrl: string, secret: string, remember: boolean): Promise<void>;
  clearCloudflare(): Promise<void>;
  testCloudflare(): Promise<boolean>;
}

const NONE: AuthStatus = { state: "unauthenticated", kind: "none" };

export const useAuthStore = create<AuthState>((set, get) => ({
  status: NONE,
  cloudflareRemembered: false,
  apiKeyStatus: { state: "unauthenticated", kind: "api_key" },
  oauthStatus: { state: "unauthenticated", kind: "oauth" },
  apiKeyRemembered: false,
  busy: false,
  lastError: null,

  async refresh() {
    const { auth, cloudflareAuth } = getServices();
    const [status, apiKeyStatus, oauthStatus, apiKeyRemembered, cloudflareRemembered] = await Promise.all([
      auth.getStatus(),
      auth.apiKey.getStatus(),
      auth.oauth.getStatus(),
      auth.apiKey.isRemembered(),
      cloudflareAuth.isRemembered(),
    ]);
    set({ status, apiKeyStatus, oauthStatus, apiKeyRemembered, cloudflareRemembered });
    // Per-provider auth statuses and model lists live in TanStack Query; credentials changed, so they are stale.
    const queryClient = getQueryClient();
    await Promise.all([queryClient.invalidateQueries({ queryKey: queryKeys.allAuthStatus }), queryClient.invalidateQueries({ queryKey: queryKeys.allModels })]);
  },

  async setActiveKind(kind) {
    getServices().auth.setActiveKind(kind);
    getServices().gemini.invalidateModelCache();
    await get().refresh();
  },

  async saveApiKey(apiKey, remember) {
    set({ busy: true, lastError: null });
    try {
      await getServices().auth.apiKey.authenticate({ apiKey, remember });
      getServices().auth.setActiveKind("api_key");
      getServices().gemini.invalidateModelCache();
      await get().refresh();
    } catch (err) {
      set({ lastError: toGenerationError(err) });
      throw err;
    } finally {
      set({ busy: false });
    }
  },

  async removeApiKey() {
    const { auth } = getServices();
    await auth.apiKey.revoke();
    if (auth.activeKind === "api_key") auth.setActiveKind("none");
    await get().refresh();
  },

  async testConnection() {
    set({ busy: true, lastError: null });
    try {
      await getServices().gemini.validateCredentials();
      await get().refresh();
      return true;
    } catch (err) {
      set({ lastError: toGenerationError(err) });
      await get().refresh();
      return false;
    } finally {
      set({ busy: false });
    }
  },

  async signInWithGoogle(signal) {
    set({ busy: true, lastError: null });
    try {
      await getServices().auth.oauth.authenticate({ signal });
      getServices().auth.setActiveKind("oauth");
      getServices().gemini.invalidateModelCache();
      await get().refresh();
    } catch (err) {
      const error = toGenerationError(err);
      if (error.code !== "CANCELLED") set({ lastError: error });
      throw err;
    } finally {
      set({ busy: false });
    }
  },

  async signOutGoogle() {
    const { auth } = getServices();
    set({ busy: true });
    try {
      await auth.oauth.revoke();
      if (auth.activeKind === "oauth") auth.setActiveKind("none");
      await get().refresh();
    } finally {
      set({ busy: false });
    }
  },

  async setProjectId(projectId) {
    await getServices().auth.oauth.setProjectId(projectId);
    getServices().gemini.invalidateModelCache();
    await get().refresh();
  },

  async listProjects() {
    return getServices().auth.oauth.listProjects();
  },

  async saveCloudflareDirect(accountId, apiToken, remember) {
    set({ busy: true, lastError: null });
    try {
      await getServices().cloudflareAuth.saveDirect({ accountId, apiToken, remember });
      await get().refresh();
    } catch (err) {
      set({ lastError: toGenerationError(err) });
      throw err;
    } finally {
      set({ busy: false });
    }
  },

  async saveCloudflareWorker(workerUrl, secret, remember) {
    set({ busy: true, lastError: null });
    try {
      await getServices().cloudflareAuth.saveWorker({ workerUrl, secret, remember });
      await get().refresh();
    } catch (err) {
      set({ lastError: toGenerationError(err) });
      throw err;
    } finally {
      set({ busy: false });
    }
  },

  async clearCloudflare() {
    await getServices().cloudflareAuth.clear();
    await get().refresh();
  },

  async testCloudflare() {
    set({ busy: true, lastError: null });
    try {
      await getServices().cloudflare.validateCredentials();
      getServices().cloudflare.invalidateModelCache();
      await get().refresh();
      return true;
    } catch (err) {
      set({ lastError: toGenerationError(err) });
      await get().refresh();
      return false;
    } finally {
      set({ busy: false });
    }
  },
}));
