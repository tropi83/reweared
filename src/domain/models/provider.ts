import type { AspectRatio, ImageSize } from "./generation";

export type ModelTier = "fast" | "balanced" | "professional" | "legacy";

export interface ModelCapabilities {
  imageGeneration: boolean;
  imageEditing: boolean;
  maxInputImages: number;
  supportedAspectRatios: AspectRatio[];
  /** Empty when the model does not accept an image size parameter. */
  supportedImageSizes: ImageSize[];
  /**
   * Present when the model needs its input image pre-sized by the app (diffusion models):
   * the output follows the input, so ratio and resolution are decided client-side.
   */
  inputImage?: {
    defaultDimension: number;
    maxDimension: number;
    minDimension?: number;
    multipleOf?: number;
    cropsToAspectRatio?: boolean;
  };
  /** Provider-specific option schema, rendered by the composer's "Advanced" panel. */
  options?: ProviderOptionSpec[];
}

export interface ProviderOptionSpec {
  key: string;
  /** i18n key for the label. */
  labelKey: string;
  type: "number" | "text" | "boolean";
  min?: number;
  max?: number;
  step?: number;
  default: number | string | boolean;
  /** i18n key for the help text. */
  helpKey?: string;
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

export type CredentialKind = "api_key" | "api_token" | "oauth" | "none";

export interface ProviderInfo {
  id: string;
  displayName: string;
  /** Which credential kinds the provider accepts. */
  credentialKinds: CredentialKind[];
  /** Short i18n key describing pricing ("free while in beta", "pay as you go"). */
  pricingKey?: string;
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
