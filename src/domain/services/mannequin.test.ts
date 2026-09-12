import { describe, expect, it } from "vitest";
import { DEFAULT_MANNEQUIN, MANNEQUIN_BUILDS, MANNEQUIN_POSES, SKIN_TONES } from "@/domain/models";
import { describeWearer, mannequinApplies, normalizeMannequin, posePhrase } from "./mannequin";

describe("mannequin", () => {
  it("applies to every category whose wearer is an adult, never kids or pets", () => {
    for (const id of ["women", "men", "home", "electronics", "entertainment", "hobbies", "sport", "luxury"] as const)
      expect(mannequinApplies(id), id).toBe(true);
    expect(mannequinApplies("kids")).toBe(false);
    expect(mannequinApplies("pets")).toBe(false);
  });

  it("describes the wearer with body type and skin tone", () => {
    expect(describeWearer("a woman", { build: "S", pose: "standing", skinTone: "fair" })).toBe("a woman with a slim build and fair skin");
    expect(describeWearer("a man", { build: "L", pose: "sitting", skinTone: "deep" })).toBe("a man with a fuller, plus-size build and deep dark skin");
    const all = new Set<string>();
    for (const build of MANNEQUIN_BUILDS) for (const skinTone of SKIN_TONES) all.add(describeWearer("a person", { build, pose: "standing", skinTone }));
    expect(all.size).toBe(MANNEQUIN_BUILDS.length * SKIN_TONES.length);
  });

  it("has one distinct pose phrase per posture", () => {
    expect(new Set(MANNEQUIN_POSES.map(posePhrase)).size).toBe(MANNEQUIN_POSES.length);
    expect(posePhrase("arched")).toMatch(/arched back/);
    expect(posePhrase("crouching")).toBe("crouching down");
  });

  it("normalizes stored values field by field", () => {
    expect(normalizeMannequin(undefined)).toBeUndefined();
    expect(normalizeMannequin("M")).toBeUndefined();
    expect(normalizeMannequin({ build: "XL", pose: "sitting", skinTone: "blue" })).toEqual({
      build: DEFAULT_MANNEQUIN.build,
      pose: "sitting",
      skinTone: DEFAULT_MANNEQUIN.skinTone,
    });
    expect(normalizeMannequin({ build: "S", pose: "arched", skinTone: "olive" })).toEqual({ build: "S", pose: "arched", skinTone: "olive" });
  });
});
