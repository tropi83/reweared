/**
 * Image picking per platform: desktop/web file dialog, phone photo library (Tauri dialog in image
 * picker mode, URI read through the fs plugin) and phone camera (<input capture>).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const open = vi.fn();
const readFile = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: (...args: unknown[]) => open(...args) }));
vi.mock("@tauri-apps/plugin-fs", () => ({ readFile: (...args: unknown[]) => readFile(...args) }));

let platform = { isMobile: false, nativeDialogs: false };
vi.mock("@/infrastructure/platform/capabilities", () => ({ getPlatform: () => platform }));

import { fileNameFromPath, pickImageFile } from "./useImageImport";

/** Captures the <input type=file> the web/camera path creates and answers it with `file`. */
function interceptFileInput(file: File | null) {
  const created: HTMLInputElement[] = [];
  const original = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    const el = original(tag);
    if (tag === "input") {
      created.push(el as HTMLInputElement);
      vi.spyOn(el as HTMLInputElement, "click").mockImplementation(function (this: HTMLInputElement) {
        if (file) Object.defineProperty(this, "files", { value: [file] });
        queueMicrotask(() => (file ? this.onchange?.(new Event("change")) : this.oncancel?.(new Event("cancel"))));
      });
    }
    return el;
  });
  return created;
}

describe("pickImageFile", () => {
  beforeEach(() => {
    open.mockReset();
    readFile.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("web: uses an <input type=file> with explicit image types, no capture", async () => {
    platform = { isMobile: false, nativeDialogs: false };
    const inputs = interceptFileInput(new File([new Uint8Array([1])], "a.png", { type: "image/png" }));
    const file = await pickImageFile();
    expect(file?.name).toBe("a.png");
    expect(inputs[0]?.accept).toContain("image/png");
    expect(inputs[0]?.hasAttribute("capture")).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it("web: resolves null when the picker is cancelled", async () => {
    platform = { isMobile: false, nativeDialogs: false };
    interceptFileInput(null);
    expect(await pickImageFile()).toBeNull();
  });

  it("desktop: native dialog without picker mode, file read from the returned path", async () => {
    platform = { isMobile: false, nativeDialogs: true };
    open.mockResolvedValue("C:\\Users\\me\\Pictures\\shirt.JPG");
    readFile.mockResolvedValue(new Uint8Array([1, 2, 3]));
    const file = await pickImageFile();
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ multiple: false, directory: false }));
    expect(open.mock.calls[0]?.[0]).not.toHaveProperty("pickerMode");
    expect(readFile).toHaveBeenCalledWith("C:\\Users\\me\\Pictures\\shirt.JPG");
    expect(file?.name).toBe("shirt.JPG");
    expect(file?.size).toBe(3);
  });

  it("mobile: 'auto' opens the photo library (image picker mode) and reads the content URI", async () => {
    platform = { isMobile: true, nativeDialogs: true };
    open.mockResolvedValue("content://com.android.providers.media.documents/document/image%3A1234");
    readFile.mockResolvedValue(new Uint8Array([9]));
    const file = await pickImageFile();
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ pickerMode: "image" }));
    expect(readFile).toHaveBeenCalledWith("content://com.android.providers.media.documents/document/image%3A1234");
    // Opaque media ids get a neutral file name instead of "image:1234".
    expect(file?.name).toBe("photo.jpg");
  });

  it("mobile: 'camera' uses <input accept=image/* capture=environment> even when native dialogs exist", async () => {
    platform = { isMobile: true, nativeDialogs: true };
    const inputs = interceptFileInput(new File([new Uint8Array([1])], "IMG_0001.jpeg", { type: "image/jpeg" }));
    const file = await pickImageFile("camera");
    expect(open).not.toHaveBeenCalled();
    expect(inputs[0]?.getAttribute("capture")).toBe("environment");
    expect(inputs[0]?.accept).toBe("image/*");
    expect(file?.name).toBe("IMG_0001.jpeg");
  });

  it("returns null when the native dialog is dismissed", async () => {
    platform = { isMobile: true, nativeDialogs: true };
    open.mockResolvedValue(null);
    expect(await pickImageFile("gallery")).toBeNull();
    expect(readFile).not.toHaveBeenCalled();
  });
});

describe("fileNameFromPath", () => {
  it("keeps real file names (decoded) and neutralises opaque ids", () => {
    expect(fileNameFromPath("/tmp/My%20photo.png")).toBe("My photo.png");
    expect(fileNameFromPath("file:///private/var/mobile/IMG_1.HEIC")).toBe("IMG_1.HEIC");
    expect(fileNameFromPath("content://media/external/images/media/42")).toBe("photo.jpg");
    expect(fileNameFromPath("content://x/y/%E0%A4%A")).toBe("photo.jpg");
  });
});
