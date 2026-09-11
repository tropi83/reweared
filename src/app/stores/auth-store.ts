import { create } from "zustand";
import { toGenerationError, type AuthStatus, type CredentialKind, type GenerationError } from "@/domain/models";
import type { GoogleCloudProject } from "@/infrastructure/auth/GoogleOAuthCredentialProvider";
import { getServices } from "../services";

interface AuthState {
  status: AuthStatus;
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
}

const NONE: AuthStatus = { state: "unauthenticated", kind: "none" };

export const useAuthStore = create<AuthState>((set, get) => ({
  status: NONE,
  apiKeyStatus: { state: "unauthenticated", kind: "api_key" },
  oauthStatus: { state: "unauthenticated", kind: "oauth" },
  apiKeyRemembered: false,
  busy: false,
  lastError: null,

  async refresh() {
    const { auth } = getServices();
    const [status, apiKeyStatus, oauthStatus, apiKeyRemembered] = await Promise.all([
      auth.getStatus(),
      auth.apiKey.getStatus(),
      auth.oauth.getStatus(),
      auth.apiKey.isRemembered(),
    ]);
    set({ status, apiKeyStatus, oauthStatus, apiKeyRemembered });
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
}));
