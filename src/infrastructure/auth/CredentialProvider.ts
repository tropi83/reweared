import type { AuthStatus, CredentialKind } from "@/domain/models";

export interface AuthResult {
  status: AuthStatus;
}

/**
 * A way to obtain request headers for a provider. The rest of the app never learns whether
 * the headers carry an API key or an OAuth bearer token.
 */
export interface CredentialProvider {
  readonly kind: CredentialKind;
  /** Interactive (OAuth) or given credentials (API key). */
  authenticate(input?: unknown): Promise<AuthResult>;
  refresh(): Promise<AuthResult>;
  revoke(): Promise<void>;
  getStatus(): Promise<AuthStatus>;
  /** Throws AppError(AUTH_REQUIRED | AUTH_EXPIRED) when no usable credential exists. */
  getRequestHeaders(): Promise<Record<string, string>>;
}
