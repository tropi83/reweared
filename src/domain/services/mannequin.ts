import {
  DEFAULT_MANNEQUIN,
  MANNEQUIN_BUILDS,
  MANNEQUIN_POSES,
  SKIN_TONES,
  type ListingCategoryId,
  type Mannequin,
  type MannequinBuild,
  type MannequinPose,
  type SkinTone,
} from "@/domain/models";

// English: image models are prompted in English (see listing-catalog.ts).
const BUILD: Record<MannequinBuild, string> = { S: "a slim build", M: "an average build", L: "a fuller, plus-size build" };
const SKIN: Record<SkinTone, string> = {
  "very-fair": "very fair skin",
  fair: "fair skin",
  medium: "medium skin",
  olive: "olive skin",
  brown: "brown skin",
  deep: "deep dark skin",
};
const POSE: Record<MannequinPose, string> = {
  standing: "standing naturally",
  arched: "standing with a slightly arched back and one hip out, in a confident fashion pose",
  crouching: "crouching down",
  sitting: "sitting on a stool",
};
/** Categories whose wearer is not an adult the seller could stand in for ("a child", "a pet"). */
const EXCLUDED: ReadonlySet<ListingCategoryId> = new Set<ListingCategoryId>(["kids", "pets"]);

export function mannequinApplies(categoryId: ListingCategoryId): boolean {
  return !EXCLUDED.has(categoryId);
}

/** "a woman" + mannequin → "a woman with a slim build and fair skin". */
export function describeWearer(baseWearer: string, m: Mannequin): string {
  return `${baseWearer} with ${BUILD[m.build]} and ${SKIN[m.skinTone]}`;
}

export function posePhrase(pose: MannequinPose): string {
  return POSE[pose];
}

/** Settings are user data: keep known values, fall back to the default field by field. */
export function normalizeMannequin(value: unknown): Mannequin | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  const pick = <T extends string>(list: readonly T[], x: unknown, fallback: T): T => (list.includes(x as T) ? (x as T) : fallback);
  return {
    build: pick(MANNEQUIN_BUILDS, v.build, DEFAULT_MANNEQUIN.build),
    pose: pick(MANNEQUIN_POSES, v.pose, DEFAULT_MANNEQUIN.pose),
    skinTone: pick(SKIN_TONES, v.skinTone, DEFAULT_MANNEQUIN.skinTone),
  };
}
