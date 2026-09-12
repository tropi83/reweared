import { describe, expect, it } from "vitest";
import { BUILT_IN_RECIPES, extractVariables, interpolate } from "./recipes";

describe("recipes", () => {
  it("extracts unique variables in order", () => {
    expect(extractVariables("A {{color}} thing on {{ surface }} with {{color}}")).toEqual(["color", "surface"]);
  });

  it("interpolates values and cleans up unfilled placeholders", () => {
    const out = interpolate("Place it on a {{background}} background, {{mood}} lighting.", { background: "white" });
    expect(out).toBe("Place it on a white background, lighting.");
  });

  it("trims and collapses whitespace introduced by removals", () => {
    expect(interpolate("{{a}}   hello   {{b}} ", {})).toBe("hello");
  });

  it("built-in recipes are the 56 listing packs with four or five shots each", () => {
    expect(BUILT_IN_RECIPES.length).toBe(56);
    for (const recipe of BUILT_IN_RECIPES) {
      expect(recipe.id.startsWith("rcp_listing_")).toBe(true);
      expect(recipe.category).toBe("listing");
      expect(recipe.shots!.length).toBeGreaterThanOrEqual(4);
      expect(recipe.shots!.length).toBeLessThanOrEqual(5);
      expect(recipe.listing).toBeDefined();
      expect(recipe.promptTemplate.length).toBeGreaterThan(20);
      expect(recipe.builtIn).toBe(true);
    }
    expect(new Set(BUILT_IN_RECIPES.map((r) => r.id)).size).toBe(BUILT_IN_RECIPES.length);
  });
});
