import { describe, expect, it } from "vitest";
import { listingDocumentDto, listingSummaryDto } from "@aiv/contracts/listing";
import { toDocument, toSummary } from "./to-dto";

const created = new Date("2026-10-11T20:00:00.000Z");
const updated = new Date("2026-10-11T21:00:00.000Z");
const row = {
  id: "lst_0123456789abcdef",
  userId: "u1",
  name: "Blue shirt",
  originalImageId: "img_000000000000aaaa",
  coverImageId: null,
  category: { categoryId: "men" as const, subcategoryId: "clothing" },
  brand: null,
  useMannequin: false,
  copy: null,
  toPost: ["img_000000000000aaaa"],
  createdAt: created,
  updatedAt: updated,
};
const image = (id: string, kind: "original" | "generation") => ({
  id,
  listingId: row.id,
  userId: "u1",
  kind,
  mimeType: "image/jpeg" as const,
  width: 800,
  height: 600,
  byteSize: 1234,
  fileName: kind === "original" ? "shirt.jpg" : null,
  objectKey: "k",
  thumbKey: "t",
  sha256: "0".repeat(64),
  generationId: null,
  jobId: null,
  createdAt: created,
});

describe("listing rows to DTOs", () => {
  const images = [image("img_000000000000aaaa", "original"), image("img_000000000000bbbb", "generation")];

  it("builds a document the contract accepts, without nulls or storage keys", () => {
    const doc = toDocument(row, images);
    expect(listingDocumentDto.parse(doc)).toEqual(doc);
    expect(doc.listing).toEqual({
      id: row.id,
      name: "Blue shirt",
      originalImageId: "img_000000000000aaaa",
      category: { categoryId: "men", subcategoryId: "clothing" },
      useMannequin: false,
      createdAt: "2026-10-11T20:00:00.000Z",
      updatedAt: "2026-10-11T21:00:00.000Z",
    });
    expect(JSON.stringify(doc)).not.toMatch(/objectKey|thumbKey|sha256|userId/);
    expect(doc.images["img_000000000000aaaa"]?.fileName).toBe("shirt.jpg");
  });

  it("summarizes like the clients do", () => {
    const summary = toSummary(row, images);
    expect(listingSummaryDto.parse(summary)).toEqual(summary);
    expect(summary).toEqual({
      id: row.id,
      name: "Blue shirt",
      coverImageId: "img_000000000000aaaa",
      category: { categoryId: "men", subcategoryId: "clothing" },
      imageCount: 1,
      updatedAt: "2026-10-11T21:00:00.000Z",
    });
  });
});
