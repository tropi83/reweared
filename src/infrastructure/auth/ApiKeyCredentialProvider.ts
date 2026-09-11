import { AppError, type AuthStatus } from "@/domain/models";
import type { AuthResult, CredentialProvider } from "./CredentialProvider";
import type { LayeredSecretStore } from "./SecretStore";

export interface ApiKeyInput {
  apiKey: string;
  remember: boolean;
}

/** Google's "x-goog-api-key" header, per https://ai.google.dev/gemini-api/docs/api-key. */
export class ApiKeyCredentialProvider implements CredentialProvider {
  readonly kind = "api_key" as const;
  private key: string | null = null;
  private loading: Promise<void> | null = null;
  private rejected = false;

  constructor(private readonly secrets: LayeredSecretStore) {}

  /** Loads once; concurrent callers share the same promise. */
  private load(): Promise<void> {
    this.loading ??= this.secrets.get("gemini_api_key").then((key) => {
      this.key = key;
    });
    return this.loading;
  }

  async authenticate(input?: unknown): Promise<AuthResult> {
    const { apiKey, remember } = input as ApiKeyInput;
    const trimmed = apiKey.trim();
    if (trimmed.length < 20 || /\s/.test(trimmed)) {
      throw new AppError("INVALID_CREDENTIAL", "This does not look like a valid API key.");
    }
    await this.secrets.set("gemini_api_key", trimmed, remember);
    this.key = trimmed;
    this.loading = Promise.resolve();
    this.rejected = false;
    return { status: await this.getStatus() };
  }

  async refresh(): Promise<AuthResult> {
    return { status: await this.getStatus() };
  }

  async revoke(): Promise<void> {
    await this.secrets.delete("gemini_api_key");
    this.key = null;
    this.rejected = false;
  }

  /** Called by the provider when Google rejects the key so the UI can reflect it. */
  markRejected(): void {
    this.rejected = true;
  }

  async isRemembered(): Promise<boolean> {
    return this.secrets.isRemembered("gemini_api_key");
  }

  async getStatus(): Promise<AuthStatus> {
    await this.load();
    if (!this.key) return { state: "unauthenticated", kind: "api_key" };
    const label = `…${this.key.slice(-4)}`;
    return { state: this.rejected ? "invalid" : "authenticated", kind: "api_key", label };
  }

  async getRequestHeaders(): Promise<Record<string, string>> {
    await this.load();
    if (!this.key) throw new AppError("AUTH_REQUIRED", "No API key configured.");
    return { "x-goog-api-key": this.key };
  }
}
