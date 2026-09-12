import type { FieldFillResult, FillReport, PublishPayload } from "@/domain/services/publish";
import type { VintedSelectors } from "./selectors";

export interface Prefill {
  run(payload: PublishPayload): void;
  readonly status: FillReport | null;
}

const THUMBNAIL_WAIT_MS = 10_000;
const THUMBNAIL_POLL_MS = 250;

/**
 * Fills Vinted's sell form. Self-contained on purpose: it is bundled into the Tauri binary and
 * evaluated inside vinted.com, where nothing from the app exists. Never clicks submit.
 * `status` stays a plain object so Rust can `JSON.stringify(window.__aivPrefill.status)`.
 */
export function createPrefill(win: Window & typeof globalThis, selectors: VintedSelectors): Prefill {
  const doc = win.document;
  let status: FillReport | null = null;

  const find = <T extends Element>(candidates: string[]): T | null => {
    for (const sel of candidates) {
      try {
        const el = doc.querySelector<T>(sel);
        if (el) return el;
      } catch {
        /* invalid selector in this engine: try the next one */
      }
    }
    return null;
  };

  // React-controlled inputs ignore `el.value = x`; go through the prototype setter, then notify.
  const setText = (el: HTMLInputElement | HTMLTextAreaElement, value: string): FieldFillResult => {
    try {
      const proto = el instanceof win.HTMLTextAreaElement ? win.HTMLTextAreaElement.prototype : win.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, value);
      else el.value = value;
      el.dispatchEvent(new win.Event("input", { bubbles: true }));
      el.dispatchEvent(new win.Event("change", { bubbles: true }));
      return "filled";
    } catch {
      return "failed";
    }
  };

  const toFile = (photo: PublishPayload["photos"][number]): File => {
    const bin = win.atob(photo.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new win.File([bytes], photo.name, { type: photo.mimeType });
  };

  const countThumbnails = () => {
    for (const sel of selectors.photoThumbnail) {
      try {
        const n = doc.querySelectorAll(sel).length;
        if (n > 0) return n;
      } catch {
        /* next */
      }
    }
    return 0;
  };

  const attachPhotos = (photos: PublishPayload["photos"], onDone: (attached: number) => void) => {
    if (photos.length === 0 || countThumbnails() > 0) return onDone(countThumbnails());
    const input = find<HTMLInputElement>(selectors.photoInput);
    if (!input) return onDone(0);
    try {
      const dt = new win.DataTransfer();
      for (const p of photos) dt.items.add(toFile(p));
      input.files = dt.files;
      input.dispatchEvent(new win.Event("change", { bubbles: true }));
    } catch {
      return onDone(0);
    }
    const started = Date.now();
    const tick = () => {
      const n = countThumbnails();
      if (n >= photos.length || Date.now() - started > THUMBNAIL_WAIT_MS) onDone(n);
      else win.setTimeout(tick, THUMBNAIL_POLL_MS);
    };
    win.setTimeout(tick, THUMBNAIL_POLL_MS);
  };

  return {
    get status() {
      return status;
    },
    run(payload) {
      const pageOk = !!find(selectors.sellFormRoot) && !!find(selectors.titleInput);
      status = { pageOk, title: "not_found", description: "not_found", photos: { requested: payload.photos.length, attached: 0 } };
      if (!pageOk) return;
      const title = find<HTMLInputElement>(selectors.titleInput);
      const description = find<HTMLTextAreaElement>(selectors.descriptionInput);
      status = {
        ...status,
        title: title ? setText(title, payload.title) : "not_found",
        description: description ? setText(description, payload.description) : "not_found",
      };
      attachPhotos(payload.photos, (attached) => {
        status = status && { ...status, photos: { requested: payload.photos.length, attached } };
      });
    },
  };
}
