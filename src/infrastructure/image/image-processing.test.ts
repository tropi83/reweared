import { describe, expect, it } from "vitest";
import { fitWithin, sniffMimeType, validateImageFile } from "./image-processing";

function blobOf(bytes: number[], type = ""): Blob {
  return new Blob([Uint8Array.from(bytes)], { type });
}

describe("image-processing", () => {
  it("sniffs common formats from magic bytes", async () => {
    expect(await sniffMimeType(blobOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toBe("image/png");
    expect(await sniffMimeType(blobOf([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("image/jpeg");
    expect(await sniffMimeType(blobOf([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe("image/gif");
    const webp = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38];
    expect(await sniffMimeType(blobOf(webp))).toBe("image/webp");
    expect(await sniffMimeType(blobOf([0x3c, 0x73, 0x76, 0x67]))).toBeNull();
  });

  it("rejects spoofed MIME types and unsupported content", async () => {
    await expect(validateImageFile(blobOf([0x3c, 0x73, 0x76, 0x67, 0x3e], "image/png"))).rejects.toMatchObject({ code: "UNSUPPORTED_FORMAT" });
    await expect(validateImageFile(new Blob([]))).rejects.toMatchObject({ code: "INVALID_IMAGE" });
  });

  it("accepts real PNG bytes regardless of the declared type", async () => {
    const result = await validateImageFile(blobOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3], "application/octet-stream"));
    expect(result.mimeType).toBe("image/png");
  });

  it("fits dimensions within a bound while keeping the ratio", () => {
    expect(fitWithin(4000, 2000, 1000)).toEqual({ width: 1000, height: 500 });
    expect(fitWithin(300, 900, 450)).toEqual({ width: 150, height: 450 });
    expect(fitWithin(100, 100, 1000)).toEqual({ width: 100, height: 100 });
  });
});
