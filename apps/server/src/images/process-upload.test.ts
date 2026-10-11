import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { processUpload, safeFileName } from "./process-upload";

const MAX = 40 * 1024 * 1024;

/** A 200×100 image with a red left half, so orientation changes are visible in the pixels. */
function canvas(width = 200, height = 100) {
  return sharp({ create: { width, height, channels: 3, background: { r: 0, g: 0, b: 255 } } }).composite([
    { input: { create: { width: width / 2, height, channels: 3, background: { r: 255, g: 0, b: 0 } } }, left: 0, top: 0 },
  ]);
}

/** A phone-like JPEG: EXIF orientation 6 (rotate 90° clockwise to display), camera model and GPS position. */
async function phoneJpeg(): Promise<Buffer> {
  const jpeg = await canvas().jpeg().toBuffer();
  // sharp writes the orientation tag from withMetadata(), the other EXIF fields from withExif().
  return sharp(jpeg)
    .withMetadata({ orientation: 6 })
    .withExif({
      IFD0: { Make: "PhoneMaker", Model: "Phone 15" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "48/1 51/1 2400/100", GPSLongitudeRef: "E", GPSLongitude: "2/1 21/1 300/100" },
    })
    .jpeg()
    .toBuffer();
}

describe("processUpload", () => {
  it("drops EXIF and GPS, applies the orientation and makes a WebP thumbnail", async () => {
    const input = await phoneJpeg();
    const before = await sharp(input).metadata();
    expect(before.orientation).toBe(6);
    expect(before.exif).toBeDefined();
    expect(input.includes(Buffer.from("PhoneMaker"))).toBe(true);

    const out = await processUpload(input, { maxBytes: MAX });
    const after = await sharp(out.original.bytes).metadata();
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.iptc).toBeUndefined();
    expect(after.orientation).toBeUndefined();
    expect(out.original.bytes.includes(Buffer.from("PhoneMaker"))).toBe(false);
    // Upright: 200×100 rotated a quarter turn.
    expect([out.original.width, out.original.height]).toEqual([100, 200]);
    expect(out.original).toMatchObject({ mimeType: "image/jpeg", extension: "jpg" });
    // The red half is now on top.
    const { data } = await sharp(out.original.bytes).extract({ left: 50, top: 20, width: 1, height: 1 }).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(200);
    expect(data[2]).toBeLessThan(60);

    const thumb = await sharp(out.thumbnail.bytes).metadata();
    expect(thumb.format).toBe("webp");
    expect(out.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps PNG and WebP, re-encodes GIF to PNG and limits the thumbnail to 512 px", async () => {
    expect((await processUpload(await canvas().png().toBuffer(), { maxBytes: MAX })).original.mimeType).toBe("image/png");
    expect((await processUpload(await canvas().webp().toBuffer(), { maxBytes: MAX })).original.mimeType).toBe("image/webp");
    expect((await processUpload(await canvas().gif().toBuffer(), { maxBytes: MAX })).original).toMatchObject({ mimeType: "image/png", extension: "png" });
    const big = await processUpload(await canvas(2000, 1000).png().toBuffer(), { maxBytes: MAX });
    const thumb = await sharp(big.thumbnail.bytes).metadata();
    expect([thumb.width, thumb.height]).toEqual([512, 256]);
  });

  it("trusts the bytes, not the declared type, and refuses what it cannot or must not decode", async () => {
    await expect(processUpload(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"), { maxBytes: MAX })).rejects.toMatchObject({
      code: "UNSUPPORTED_MEDIA_TYPE",
    });
    await expect(processUpload(Buffer.from([0x42, 0x4d, 0, 0, 0, 0]), { maxBytes: MAX })).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE" });
    await expect(processUpload(Buffer.alloc(0), { maxBytes: MAX })).rejects.toMatchObject({ code: "INVALID_IMAGE" });
    const jpeg = await canvas().jpeg().toBuffer();
    await expect(processUpload(jpeg.subarray(0, Math.floor(jpeg.length / 2)), { maxBytes: MAX })).rejects.toMatchObject({ code: "INVALID_IMAGE" });
    await expect(processUpload(jpeg, { maxBytes: 100 })).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });

  it("refuses decompression bombs before decoding them", async () => {
    // 10000×10000 = 100 MP of a single colour: a few KB of PNG.
    const bomb = await sharp({ create: { width: 10_000, height: 10_000, channels: 3, background: "#fff" } })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(bomb.length).toBeLessThan(1024 * 1024);
    await expect(processUpload(bomb, { maxBytes: MAX })).rejects.toMatchObject({ code: "INVALID_IMAGE" });
  });
});

describe("safeFileName", () => {
  it("keeps a display name without path or control characters", () => {
    expect(safeFileName("C:\\Users\\me\\Pictures\\shirt.jpg")).toBe("shirt.jpg");
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName("bad\u0000name\n.png")).toBe("badname.png");
    expect(safeFileName("x".repeat(300))).toHaveLength(120);
    expect(safeFileName("  ")).toBeUndefined();
    expect(safeFileName(undefined)).toBeUndefined();
  });
});
