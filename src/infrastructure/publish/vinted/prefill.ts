import type { FieldFillResult, FillReport, PublishPayload } from "@/domain/services/publish";
import type { VintedSelectors } from "./selectors";

export interface Prefill {
  run(payload: PublishPayload): void;
  readonly status: FillReport | null;
}

const THUMBNAIL_WAIT_MS = 10_000;
const THUMBNAIL_POLL_MS = 250;
/** Vinted renders the form after the load event (client-side routing, lazy chunks): how long to wait for it. */
const FORM_WAIT_MS = 10_000;
const FORM_POLL_MS = 250;
const PASTE_ATTR = "data-aiv-paste";
/** Lucide "clipboard-paste", inlined: nothing from the app exists on vinted.com. */
const PASTE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M15 2H9a1 1 0 0 0-1 1v2c0 .6.4 1 1 1h6c.6 0 1-.4 1-1V3c0-.6-.4-1-1-1Z"/>' +
  '<path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2M16 4h2a2 2 0 0 1 2 2v2M11 14h10"/>' +
  '<path d="m17 10 4 4-4 4"/></svg>';
const LABELS = {
  title: { fr: "Coller le titre", en: "Paste the title" },
  description: { fr: "Coller la description", en: "Paste the description" },
} as const;

type TextField = "title" | "description";

/**
 * Prepares Vinted's sell form: attaches the photos and mounts a paste icon at the end of the title and
 * description fields — the text goes in only when the user taps the icon (their action, not an
 * automated fill). Self-contained on purpose: it is bundled into the Tauri binary and evaluated inside
 * vinted.com, where nothing from the app exists. Never clicks submit.
 * `status` stays a plain object so the host can `JSON.stringify(window.__aivPrefill.status)`; it is `null`
 * until the script has decided (the form may still be rendering when the host runs it).
 */
export function createPrefill(win: Window & typeof globalThis, selectors: VintedSelectors): Prefill {
  const doc = win.document;
  let status: FillReport | null = null;
  /** Latest payload: a re-run swaps the text the icons paste without mounting them again. */
  let current: PublishPayload | null = null;

  const find = <T extends Element>(candidates: string[], root: ParentNode = doc): T | null => {
    for (const sel of candidates) {
      try {
        const el = root.querySelector<T>(sel);
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

  const setField = (field: TextField, result: FieldFillResult) => {
    status = status && { ...status, [field]: result };
  };

  /** One icon per field, inside Vinted's input wrapper so it sits at the end of the field. */
  const mountPasteIcon = (field: TextField, el: HTMLInputElement | HTMLTextAreaElement): FieldFillResult => {
    const wrapper = (el.closest(selectors.fieldWrapper.join(",")) as HTMLElement | null) ?? el.parentElement;
    if (!wrapper) return "failed";
    if (wrapper.querySelector(`button[${PASTE_ATTR}="${field}"]`)) return "ready";
    const lang = (doc.documentElement.lang || win.navigator.language || "en").toLowerCase().startsWith("fr") ? "fr" : "en";
    const button = doc.createElement("button");
    button.type = "button";
    button.setAttribute(PASTE_ATTR, field);
    button.setAttribute("aria-label", LABELS[field][lang]);
    button.title = LABELS[field][lang];
    button.innerHTML = PASTE_ICON;
    if (!/^(relative|absolute|fixed|sticky)$/.test(win.getComputedStyle(wrapper).position)) wrapper.style.position = "relative";
    // The wrapper also holds Vinted's floating label: align the icon with the field itself (centred on an
    // input, top-aligned on a textarea).
    const top = el.offsetTop + (el instanceof win.HTMLTextAreaElement ? 4 : Math.max(0, Math.round((el.offsetHeight - 32) / 2)));
    // One property at a time: an engine that rejects a value drops that value only, never the whole style.
    const styles: Record<string, string> = {
      position: "absolute",
      right: "8px",
      top: `${top}px`,
      "z-index": "2",
      width: "32px",
      height: "32px",
      display: "inline-flex",
      "align-items": "center",
      "justify-content": "center",
      border: "1px solid #d5d5d5",
      "border-radius": "16px",
      background: "#fff",
      color: "#007782",
      cursor: "pointer",
      padding: "0",
      "box-shadow": "0 1px 2px rgba(0,0,0,.08)",
    };
    for (const [name, value] of Object.entries(styles)) button.style.setProperty(name, value);
    // Leave room for the icon so the end of the text stays readable.
    el.style.paddingRight = "44px";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!current) return;
      setField(field, setText(el, current[field]));
      el.focus();
    });
    wrapper.appendChild(button);
    return "ready";
  };

  const toFile = (photo: PublishPayload["photos"][number]): File => {
    const bin = win.atob(photo.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new win.File([bytes], photo.name, { type: photo.mimeType });
  };

  // Whole document: Vinted renders the media grid outside the form. The selectors are specific
  // (`image-wrapper-N`…), so the page's own images (logo, avatar) never count.
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

  let polling = false;

  const attachPhotos = (photos: PublishPayload["photos"], onDone: (attached: number) => void) => {
    const existing = countThumbnails();
    // Re-entrant run while thumbnails are still loading: report what is there, let the in-flight poll finish.
    if (polling || photos.length === 0 || existing > 0) return onDone(existing);
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
    polling = true;
    const started = Date.now();
    const tick = () => {
      const n = countThumbnails();
      if (n >= photos.length || Date.now() - started > THUMBNAIL_WAIT_MS) {
        polling = false;
        onDone(n);
      } else win.setTimeout(tick, THUMBNAIL_POLL_MS);
    };
    win.setTimeout(tick, THUMBNAIL_POLL_MS);
  };

  let waitToken = 0;
  const formPresent = () => !!find(selectors.sellFormRoot) && !!find(selectors.titleInput);
  const notForm = (payload: PublishPayload): FillReport => ({
    pageOk: false,
    title: "not_found",
    description: "not_found",
    photos: { requested: payload.photos.length, attached: 0 },
  });

  /** The form is on screen: photos now, paste icons for the text. */
  const apply = (payload: PublishPayload) => {
    const title = find<HTMLInputElement>(selectors.titleInput);
    const description = find<HTMLTextAreaElement>(selectors.descriptionInput);
    status = {
      pageOk: true,
      title: title ? mountPasteIcon("title", title) : "not_found",
      description: description ? mountPasteIcon("description", description) : "not_found",
      photos: { requested: payload.photos.length, attached: countThumbnails() },
    };
    attachPhotos(payload.photos, (attached) => {
      status = status && { ...status, photos: { requested: payload.photos.length, attached } };
    });
  };

  return {
    get status() {
      return status;
    },
    run(payload) {
      current = payload;
      // Cancels a pending wait from a previous run (its tick checks the token).
      const token = ++waitToken;
      if (formPresent()) return apply(payload);
      status = null;
      const started = Date.now();
      const tick = () => {
        if (token !== waitToken || !current) return;
        if (formPresent()) return apply(current);
        if (Date.now() - started > FORM_WAIT_MS) {
          status = notForm(current);
          return;
        }
        win.setTimeout(tick, FORM_POLL_MS);
      };
      win.setTimeout(tick, FORM_POLL_MS);
    },
  };
}
