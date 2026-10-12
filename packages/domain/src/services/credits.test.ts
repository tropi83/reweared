import { describe, expect, it } from "vitest";
import { CREDIT_COSTS, jobCost, runCost } from "./credits";

describe("credit costs", () => {
  it("charges one credit per photo and one per listing copy", () => {
    expect(CREDIT_COSTS).toEqual({ image: 1, copy: 1 });
    expect(jobCost("image")).toBe(1);
    expect(runCost("image", 5)).toBe(5);
    expect(runCost("copy", 1)).toBe(1);
  });
});
