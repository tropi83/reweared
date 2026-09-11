import type { AspectRatio, ImageSize } from "./generation";

export type ModelTier = "fast" | "balanced" | "professional" | "legacy";

export interface ModelCapabilities {
  imageGeneration: boolean;
  imageEditing: boolean;
  maxInputImages: number;
  supportedAspectRatios: AspectRatio[];
  /** Empty when the model does not accept an image size parameter. */
  supportedImageSizes: ImageSize[];
}

export interface ModelInfo {
  id: string;
  displayName: string;
  tier: ModelTier;
  description?: string;
  capabilities: ModelCapabilities;
  /** false when the provider reported the model as unavailable for this account. */
  available: boolean;
}

export type CredentialKind = "api_key" | "oauth" | "none";

export interface ProviderInfo {
  id: string;
  displayName: string;
  /** Which credential kinds the provider accepts. */
  credentialKinds: CredentialKind[];
}

export type AuthStatusState = "unauthenticated" | "authenticated" | "expired" | "invalid";

export interface AuthStatus {
  state: AuthStatusState;
  kind: CredentialKind;
  /** Display-only account label (e-mail, key suffix). Never the credential itself. */
  label?: string;
  /** Quota/billing project used with OAuth, when applicable. */
  projectId?: string;
  message?: string;
}
