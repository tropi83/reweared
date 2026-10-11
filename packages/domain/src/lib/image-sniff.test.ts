import { describe, expect, it } from "vitest";
import { sniffImageMime } from "./image-sniff";

const bytes = (...values: number[]) => Uint8Array.from(values);
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

describe("sniffImageMime", () => {
  it("recognises every supported format from its magic bytes", () => {
    expect(sniffImageMime(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0))).toBe("image/png");
    expect(sniffImageMime(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe("image/jpeg");
    expect(sniffImageMime(bytes(...ascii("GIF89a")))).toBe("image/gif");
    expect(sniffImageMime(bytes(...ascii("BM"), 0, 0))).toBe("image/bmp");
    expect(sniffImageMime(bytes(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBPVP8 ")))).toBe("image/webp");
    expect(sniffImageMime(bytes(0, 0, 0, 0x1c, ...ascii("ftypavif"), 0, 0))).toBe("image/avif");
  });

  it("refuses other content, other ISO-BMFF brands and truncated heads", () => {
    expect(sniffImageMime(bytes(...ascii("<svg")))).toBeNull();
    expect(sniffImageMime(bytes(0, 0, 0, 0x1c, ...ascii("ftypheic")))).toBeNull();
    expect(sniffImageMime(bytes(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVE")))).toBeNull();
    expect(sniffImageMime(bytes(0x89, 0x50, 0x4e))).toBeNull();
    expect(sniffImageMime(bytes(0, 0, 0, 0x1c, ...ascii("ftyp")))).toBeNull();
    expect(sniffImageMime(new Uint8Array())).toBeNull();
  });
});
