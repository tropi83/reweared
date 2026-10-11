import { describe, expect, it } from "vitest";
import { assertSafeId, createId, SAFE_ID_PATTERN } from "./ids";

describe("ids", () => {
  it("creates prefixed ids that pass the safety pattern", () => {
    for (const prefix of ["lst", "img", "gen", "job", "rcp"] as const) {
      const id = createId(prefix);
      expect(id.startsWith(`${prefix}_`)).toBe(true);
      expect(SAFE_ID_PATTERN.test(id)).toBe(true);
      expect(assertSafeId(id)).toBe(id);
    }
  });

  it("rejects anything that could escape a directory", () => {
    for (const bad of ["../x", "prj_../..", "prj_ABC", "prj_1234567", "img_00000000/../x", "", "prj_"]) {
      expect(() => assertSafeId(bad)).toThrow(/Invalid identifier/);
    }
  });
});
