import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";

// jsdom lacks these browser APIs used by the image pipeline; tests that need them mock explicitly.
if (typeof URL.createObjectURL !== "function") {
  Object.defineProperty(URL, "createObjectURL", { value: () => "blob:mock", writable: true });
}
if (typeof URL.revokeObjectURL !== "function") {
  Object.defineProperty(URL, "revokeObjectURL", { value: () => undefined, writable: true });
}

// jsdom's Blob does not implement arrayBuffer()/text(); polyfill through FileReader.
if (typeof Blob !== "undefined" && typeof Blob.prototype.arrayBuffer !== "function") {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

// jsdom has no canvas: make getContext return null quietly so code paths fall back without noisy warnings.
if (typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement["getContext"];
}
