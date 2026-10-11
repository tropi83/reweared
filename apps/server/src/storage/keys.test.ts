import { describe, expect, it } from "vitest";
import { listingPrefix, objectKey, userPrefix } from "./keys";

const LISTING = "lst_0123456789abcdef";
const IMAGE = "img_fedcba9876543210";

describe("object keys", () => {
  it("nests user, listing, bucket and asset", () => {
    expect(objectKey("Zx81_a-B", LISTING, "original", IMAGE, "jpg")).toBe(`u/Zx81_a-B/l/${LISTING}/original/${IMAGE}.jpg`);
    expect(listingPrefix("Zx81_a-B", LISTING)).toBe(`u/Zx81_a-B/l/${LISTING}/`);
    expect(userPrefix("Zx81_a-B")).toBe("u/Zx81_a-B/");
  });

  it("refuses anything that could escape its prefix", () => {
    for (const userId of ["", "../x", "a/b", "a b", "x".repeat(65), "%2e%2e"]) expect(() => userPrefix(userId)).toThrow(/Invalid user identifier/);
    for (const id of ["../lst", "lst_../..", "lst_ABC", "img_0123/../x"]) {
      expect(() => objectKey("user1", id, "original", IMAGE, "png")).toThrow(/Invalid identifier/);
      expect(() => objectKey("user1", LISTING, "original", id, "png")).toThrow(/Invalid identifier/);
    }
  });
});
