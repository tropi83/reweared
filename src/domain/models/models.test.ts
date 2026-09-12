import { describe, expect, it } from "vitest";
import { AppError, deriveGenerationStatus, isGenerationError, isRetryableCode, summarize, toGenerationError, type ProjectDocument } from "./index";
import { buildRequestForModel } from "@/domain/services/image-provider";
import { GEMINI_IMAGE_MODELS } from "@/infrastructure/providers/gemini/GeminiModels";

describe("errors", () => {
  it("marks only transient codes as retryable by default", () => {
    expect(isRetryableCode("RATE_LIMITED")).toBe(true);
    expect(isRetryableCode("NETWORK_ERROR")).toBe(true);
    expect(isRetryableCode("TIMEOUT")).toBe(true);
    expect(isRetryableCode("PROVIDER_UNAVAILABLE")).toBe(true);
    for (const code of ["INVALID_CREDENTIAL", "CONTENT_REJECTED", "QUOTA_EXCEEDED", "INVALID_IMAGE", "MODEL_UNAVAILABLE"] as const) {
      expect(isRetryableCode(code)).toBe(false);
    }
  });

  it("serializes AppError without optional noise and normalizes foreign errors", () => {
    expect(new AppError("RATE_LIMITED", "slow", { retryAfterMs: 500 }).toJSON()).toEqual({
      code: "RATE_LIMITED",
      message: "slow",
      retryable: true,
      retryAfterMs: 500,
    });
    expect(new AppError("CONTENT_REJECTED", "no", { retryable: true }).retryable).toBe(true);
    const abort = new DOMException("x", "AbortError");
    expect(toGenerationError(abort).code).toBe("CANCELLED");
    expect(toGenerationError(new TypeError("Failed to fetch")).code).toBe("NETWORK_ERROR");
    expect(toGenerationError("boom")).toEqual({ code: "UNKNOWN_ERROR", message: "Unexpected error.", retryable: false });
    expect(isGenerationError({ code: "X", message: "m", retryable: false })).toBe(true);
    expect(isGenerationError({ code: "X" })).toBe(false);
  });
});

describe("deriveGenerationStatus", () => {
  it("aggregates job statuses", () => {
    expect(deriveGenerationStatus([])).toBe("failed");
    expect(deriveGenerationStatus([{ status: "queued" }, { status: "completed" }])).toBe("active");
    expect(deriveGenerationStatus([{ status: "completed" }, { status: "completed" }])).toBe("completed");
    expect(deriveGenerationStatus([{ status: "completed" }, { status: "failed" }])).toBe("partial");
    expect(deriveGenerationStatus([{ status: "failed" }, { status: "cancelled" }])).toBe("failed");
    expect(deriveGenerationStatus([{ status: "cancelled" }, { status: "cancelled" }])).toBe("cancelled");
  });
});

describe("summarize", () => {
  it("counts generated images and picks the cover", () => {
    const now = "2026-01-01T00:00:00.000Z";
    const doc: ProjectDocument = {
      schemaVersion: 2,
      appVersion: "t",
      project: { id: "prj_1", name: "P", originalImageId: "img_o", createdAt: now, updatedAt: now },
      images: {
        img_o: { id: "img_o", projectId: "prj_1", kind: "original", mimeType: "image/png", width: 1, height: 1, byteSize: 1, createdAt: now },
        img_g: { id: "img_g", projectId: "prj_1", kind: "generation", mimeType: "image/png", width: 1, height: 1, byteSize: 1, createdAt: now },
      },
      generations: {},
      jobs: {},
      toPost: [],
    };
    expect(summarize(doc)).toEqual({ id: "prj_1", name: "P", coverImageId: "img_o", imageCount: 1, updatedAt: now });
    doc.project.coverImageId = "img_g";
    expect(summarize(doc).coverImageId).toBe("img_g");
  });
});

describe("buildRequestForModel", () => {
  const flash = GEMINI_IMAGE_MODELS.find((m) => m.id === "gemini-3.1-flash-image")!;
  const legacy = GEMINI_IMAGE_MODELS.find((m) => m.id === "gemini-2.5-flash-image")!;
  const lite = GEMINI_IMAGE_MODELS.find((m) => m.id === "gemini-3.1-flash-lite-image")!;

  it("never forwards parameters the model does not support", () => {
    expect(buildRequestForModel(legacy, { prompt: "p", aspectRatio: "16:9", imageSize: "2K" })).toEqual({ prompt: "p", model: legacy.id, aspectRatio: "16:9" });
    expect(buildRequestForModel(lite, { prompt: "p", aspectRatio: "1:1", imageSize: "4K" })).toEqual({ prompt: "p", model: lite.id, aspectRatio: "1:1" });
    expect(buildRequestForModel(flash, { prompt: "p", aspectRatio: "original", imageSize: "512px" })).toEqual({
      prompt: "p",
      model: flash.id,
      imageSize: "512px",
    });
  });

  it("keeps the source image", () => {
    const blob = new Blob([]);
    const req = buildRequestForModel(flash, { prompt: "p", aspectRatio: "4:5", sourceImage: { blob, mimeType: "image/jpeg" } });
    expect(req.sourceImage?.mimeType).toBe("image/jpeg");
    expect(req.aspectRatio).toBe("4:5");
  });

  it("gemini catalogue is internally consistent", () => {
    expect(new Set(GEMINI_IMAGE_MODELS.map((m) => m.id)).size).toBe(GEMINI_IMAGE_MODELS.length);
    for (const m of GEMINI_IMAGE_MODELS) {
      expect(m.capabilities.supportedAspectRatios).not.toContain("original");
      expect(m.capabilities.imageEditing).toBe(true);
    }
  });
});
