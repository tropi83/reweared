import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import type { AppSettings, Generation, GenerationJob, ImageAsset, Listing, ListingSummary, Mannequin, Recipe } from "@aiv/domain/models";
import { createId } from "@aiv/domain/lib/ids";
import { errorBody } from "./common";
import { generationDto, generationJobDto, startCopyBody, startGenerationBody } from "./generation";
import { createListingBody, imageAssetDto, listingDocumentDto, listingDto, listingSummaryDto, patchListingBody } from "./listing";
import { meDto } from "./me";
import { recipeDto } from "./recipe";
import { mannequinDto, userSettingsDto } from "./settings";

const now = "2026-10-11T20:00:00.000Z";

/** Same shape: each side assignable to the other and the same keys (catches a field added on one side only). */
type SameShape<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? [keyof A] extends [keyof B]
      ? [keyof B] extends [keyof A]
        ? true
        : false
      : false
    : false
  : false;

describe("contracts mirror the domain types", () => {
  it("keeps listing, image, summary, recipe, mannequin and settings shapes in step with @aiv/domain", () => {
    // Compile-time: a drift between a schema and its domain type fails `pnpm typecheck`.
    expectTypeOf<z.infer<typeof listingDto>>().toEqualTypeOf<Listing>();
    expectTypeOf<z.infer<typeof imageAssetDto>>().toEqualTypeOf<ImageAsset>();
    expectTypeOf<z.infer<typeof listingSummaryDto>>().toEqualTypeOf<ListingSummary>();
    // Built-in recipes come from the catalogue and are never stored: the DTO is a Recipe without `builtIn`.
    expectTypeOf<SameShape<z.infer<typeof recipeDto>, Omit<Recipe, "builtIn">>>().toEqualTypeOf<true>();
    expectTypeOf<z.infer<typeof mannequinDto>>().toEqualTypeOf<Mannequin>();
    expectTypeOf<
      SameShape<z.infer<typeof userSettingsDto>, Pick<AppSettings, "locale" | "theme" | "vintedAutomationAcknowledged" | "defaultAspectRatio" | "mannequin">>
    >().toEqualTypeOf<true>();
  });
});

describe("listing contracts", () => {
  const listingId = createId("lst");
  const imageId = createId("img");

  it("accepts a document as the clients store it", () => {
    const doc = {
      schemaVersion: 3,
      appVersion: "server",
      listing: {
        id: listingId,
        name: "Blue shirt",
        originalImageId: imageId,
        category: { categoryId: "men", subcategoryId: "clothing" },
        createdAt: now,
        updatedAt: now,
      },
      images: {
        [imageId]: { id: imageId, listingId, kind: "original", mimeType: "image/jpeg", width: 800, height: 600, byteSize: 1234, createdAt: now },
      },
      generations: {},
      jobs: {},
      toPost: [imageId],
    };
    expect(listingDocumentDto.parse(doc)).toEqual(doc);
  });

  it("refuses unknown keys, unsafe ids and over-long fields in request bodies", () => {
    expect(createListingBody.safeParse({ name: "x", owner: "someone" }).success).toBe(false);
    expect(patchListingBody.safeParse({ userId: "u1" }).success).toBe(false);
    expect(patchListingBody.safeParse({ brand: "x".repeat(61) }).success).toBe(false);
    expect(patchListingBody.safeParse({ coverImageId: "../etc/passwd" }).success).toBe(false);
    expect(patchListingBody.safeParse({ category: { categoryId: "cars", subcategoryId: "x" } }).success).toBe(false);
    expect(patchListingBody.parse({ brand: null, coverImageId: null, toPost: [imageId] })).toEqual({ brand: null, coverImageId: null, toPost: [imageId] });
  });

  it("trims names and refuses empty ones", () => {
    expect(createListingBody.parse({ name: "  Jacket  " })).toEqual({ name: "Jacket" });
    expect(createListingBody.safeParse({ name: "   " }).success).toBe(false);
  });
});

describe("settings and account contracts", () => {
  it("never accepts credential-like or provider fields in user settings", () => {
    const base = { locale: "fr", theme: "dark", vintedAutomationAcknowledged: false, defaultAspectRatio: "original" };
    expect(userSettingsDto.parse(base)).toEqual(base);
    expect(userSettingsDto.safeParse({ ...base, apiKey: "AIzaFAKE" }).success).toBe(false);
    expect(userSettingsDto.safeParse({ ...base, activeProviderId: "gemini" }).success).toBe(false);
  });

  it("describes the signed-in account and the error body", () => {
    expect(meDto.parse({ id: "u_1", email: "seller@example.com", emailVerified: true, name: "Seller" }).emailVerified).toBe(true);
    expect(meDto.safeParse({ id: "u_1", email: "not-an-email", emailVerified: true, name: "" }).success).toBe(false);
    expect(errorBody.parse({ code: "NOT_FOUND", message: "Not found." })).toEqual({ code: "NOT_FOUND", message: "Not found." });
  });
});

describe("generation contracts", () => {
  it("mirror the domain's Generation and GenerationJob", () => {
    expectTypeOf<SameShape<z.infer<typeof generationDto>, Generation>>().toEqualTypeOf<true>();
    expectTypeOf<SameShape<z.infer<typeof generationJobDto>, GenerationJob>>().toEqualTypeOf<true>();
  });

  it("accept per-run options but never a provider, a model or a key", () => {
    expect(startGenerationBody.parse({ aspectRatio: "4:5", options: { guidance: 3 } })).toEqual({ aspectRatio: "4:5", options: { guidance: 3 } });
    expect(startGenerationBody.safeParse({ provider: "gemini" }).success).toBe(false);
    expect(startGenerationBody.safeParse({ model: "x" }).success).toBe(false);
    expect(startCopyBody.safeParse({ language: "de" }).success).toBe(false);
  });
});
