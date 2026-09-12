/**
 * The seller's reusable model for photos with a person (worn, on the wrist, mirror selfie…). One per
 * device, stored in the settings; gender still comes from the listing category.
 */
export type MannequinBuild = "S" | "M" | "L";
export type MannequinPose = "standing" | "arched" | "crouching" | "sitting";
export type SkinTone = "very-fair" | "fair" | "medium" | "olive" | "brown" | "deep";

export interface Mannequin {
  build: MannequinBuild;
  pose: MannequinPose;
  skinTone: SkinTone;
}

export const MANNEQUIN_BUILDS: readonly MannequinBuild[] = ["S", "M", "L"];
export const MANNEQUIN_POSES: readonly MannequinPose[] = ["standing", "arched", "crouching", "sitting"];
export const SKIN_TONES: readonly SkinTone[] = ["very-fair", "fair", "medium", "olive", "brown", "deep"];

/** Display colours of the skin-tone picker (UI only, never sent to a model). */
export const SKIN_TONE_SWATCH: Record<SkinTone, string> = {
  "very-fair": "#F3D9C4",
  fair: "#E8BF9F",
  medium: "#C99570",
  olive: "#A9764F",
  brown: "#7B4E32",
  deep: "#4A2C1D",
};

export const DEFAULT_MANNEQUIN: Mannequin = { build: "M", pose: "standing", skinTone: "medium" };
