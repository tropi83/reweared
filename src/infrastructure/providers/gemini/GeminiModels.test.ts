import { describe, expect, it } from "vitest";
import { buildRequestForModel } from "@/domain/services/image-provider";
import { GEMINI_IMAGE_MODELS } from "./GeminiModels";

describe("GEMINI_IMAGE_MODELS", () => {
  const flash = GEMINI_IMAGE_MODELS.find((m) => m.id === "gemini-3.1-flash-image")!;
  const legacy = GEMINI_IMAGE_MODELS.find((m) => m.id === "gemini-2.5-flash-image")!;
  const lite = GEMINI_IMAGE_MODELS.find((m) => m.id === "gemini-3.1-flash-lite-image")!;

  it("drives the request: no image size for legacy, 1K only for Lite, no aspect ratio for 'original'", () => {
    expect(buildRequestForModel(legacy, { prompt: "p", aspectRatio: "16:9", imageSize: "2K" })).toEqual({ prompt: "p", model: legacy.id, aspectRatio: "16:9" });
    expect(buildRequestForModel(lite, { prompt: "p", aspectRatio: "1:1", imageSize: "4K" })).toEqual({ prompt: "p", model: lite.id, aspectRatio: "1:1" });
    expect(buildRequestForModel(flash, { prompt: "p", aspectRatio: "original", imageSize: "512px" })).toEqual({
      prompt: "p",
      model: flash.id,
      imageSize: "512px",
    });
  });

  it("is internally consistent", () => {
    expect(new Set(GEMINI_IMAGE_MODELS.map((m) => m.id)).size).toBe(GEMINI_IMAGE_MODELS.length);
    for (const m of GEMINI_IMAGE_MODELS) {
      expect(m.capabilities.supportedAspectRatios).not.toContain("original");
      expect(m.capabilities.imageEditing).toBe(true);
    }
  });
});
