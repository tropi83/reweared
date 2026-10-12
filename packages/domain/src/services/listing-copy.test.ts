import { describe, expect, it } from "vitest";
import { buildListingCopyPrompt, LISTING_COPY_JSON_SCHEMA, parseListingCopy } from "./listing-copy";

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const image = { blob: new Blob([JPEG], { type: "image/jpeg" }), mimeType: "image/jpeg" as const };

describe("listing copy prompt & parsing", () => {
  it("includes the taxonomy, the language and the JSON contract", () => {
    const prompt = buildListingCopyPrompt({ image, category: { categoryId: "women", subcategoryId: "clothing" }, language: "fr" });
    expect(prompt).toContain("Women › Clothing");
    expect(prompt).toContain("Write in French");
    expect(prompt).toContain('"keywords"');
    expect(buildListingCopyPrompt({ image, language: "en" })).toContain("category is unknown");
    expect(LISTING_COPY_JSON_SCHEMA.required).toContain("title");
  });

  it("imposes the seller's brand (JSON-quoted) or keeps the 'only if readable' rule", () => {
    const withBrand = buildListingCopyPrompt({ image, language: "fr", brand: '  Levi\'s "501" ' });
    expect(withBrand).toContain('The seller states the brand is "Levi\'s \\"501\\""');
    expect(withBrand).not.toContain("clearly readable");
    const without = buildListingCopyPrompt({ image, language: "fr", brand: "   " });
    expect(without).toContain("only if it is clearly readable");
    expect(without).not.toContain("seller states the brand");
  });

  it("parses JSON wrapped in prose or code fences and normalizes fields", () => {
    const raw =
      'Sure! ```json\n{"title":"  Chemise blanche   cintrée ","description":"Belle chemise.\\n\\nPeu portée.","condition":"very_good","brand":null,"color":" blanc ","keywords":["Chemise","chemise","blanc","femme"]}\n```';
    const copy = parseListingCopy(raw);
    expect(copy).toEqual({
      title: "Chemise blanche cintrée",
      description: "Belle chemise.\n\nPeu portée.",
      condition: "very_good",
      color: "blanc",
      keywords: ["chemise", "blanc", "femme"],
    });
  });

  it("strips a leading '#' from keywords so the UI never shows '##'", () => {
    const copy = parseListingCopy(JSON.stringify({ title: "T", description: "D", keywords: ["#Nike", " # running ", "shoes", "#", "  "] }));
    expect(copy.keywords).toEqual(["nike", "running", "shoes"]);
  });

  it("truncates to the limits and drops unknown conditions / placeholder brands", () => {
    const copy = parseListingCopy(
      JSON.stringify({
        title: "x".repeat(100),
        description: "d".repeat(2000),
        condition: "mint",
        brand: "unknown",
        keywords: Array.from({ length: 20 }, (_, i) => `k${i}`),
      }),
    );
    expect(copy.title).toHaveLength(70);
    expect(copy.description).toHaveLength(800);
    expect(copy.condition).toBeUndefined();
    expect(copy.brand).toBeUndefined();
    expect(copy.keywords).toHaveLength(8);
  });

  it("rejects non-JSON or empty answers", () => {
    expect(() => parseListingCopy("I cannot see the image")).toThrow(/JSON/);
    expect(() => parseListingCopy('{"title":"","description":"x"}')).toThrow(/empty/);
    expect(() => parseListingCopy("{not json}")).toThrow(/malformed/);
  });
});
