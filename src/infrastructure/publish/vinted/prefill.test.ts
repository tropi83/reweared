import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrefill } from "./prefill";
import { VINTED_SELECTORS, type VintedSelectors } from "./selectors";

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/**
 * Stand-in for Vinted's React-controlled sell form, mirroring the live markup (checked on the mobile web
 * on 2026-09-13): the media grid and the hidden file input live OUTSIDE the <form>; each field is an
 * <input> inside `.web_ui__Input__content`.
 */
function mountForm({ withDescription = true, thumbnailDelayMs = 0 } = {}) {
  document.body.innerHTML = `
    <div data-testid="media-upload">
      <input type="file" accept="image/jpeg,image/png" multiple class="u-hidden" data-testid="add-photos-input" name="photos" />
      <div data-testid="media-upload-grid"></div>
    </div>
    <form>
      <label class="web_ui__Input__input" data-testid="title"><div class="web_ui__Input__content"><input class="web_ui__Input__value" id="title" name="title" data-testid="title--input" value="" /></div></label>
      ${withDescription ? '<label class="web_ui__Input__input" data-testid="description"><div class="web_ui__Input__content"><textarea id="description" name="description" data-testid="description--input"></textarea></div></label>' : ""}
      <button type="submit">Ajouter</button>
    </form>`;
  const seen = { title: [] as string[], description: [] as string[] };
  // React listens to native "input" events; record what a controlled component would see.
  document.querySelector('[name="title"]')!.addEventListener("input", (e) => seen.title.push((e.target as HTMLInputElement).value));
  document.querySelector('[name="description"]')?.addEventListener("input", (e) => seen.description.push((e.target as HTMLTextAreaElement).value));
  const photoInput = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  // jsdom's `files` setter only accepts a real FileList (which cannot be constructed); browsers accept DataTransfer.files.
  Object.defineProperty(photoInput, "files", { writable: true, value: null });
  photoInput.addEventListener("change", () => {
    const files = Array.from(photoInput.files ?? []);
    const render = () => {
      const box = document.querySelector('[data-testid="media-upload-grid"]')!;
      files.forEach((f, i) =>
        box.insertAdjacentHTML("beforeend", `<div data-testid="image-wrapper-${i}"><img src="https://images1.vinted.net/t/${f.name}" alt=""></div>`),
      );
    };
    if (thumbnailDelayMs > 0) setTimeout(render, thumbnailDelayMs);
    else render();
  });
  const submit = vi.fn();
  document.querySelector("form")!.addEventListener("submit", submit);
  return { seen, submit };
}

const payload = {
  title: "Chemise blanche",
  description: "Coton, très bon état.",
  photos: [
    { name: "a.png", mimeType: "image/png" as const, data: PNG_B64 },
    { name: "b.png", mimeType: "image/png" as const, data: PNG_B64 },
  ],
};

describe("vinted prefill", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const pasteButton = (field: "title" | "description") => document.querySelector<HTMLButtonElement>(`button[data-aiv-paste="${field}"]`);

  it("attaches the photos, offers a paste icon per text field and writes nothing until it is tapped; never submits", async () => {
    const { seen, submit } = mountForm();
    const prefill = createPrefill(window, VINTED_SELECTORS);
    prefill.run(payload);
    await vi.advanceTimersByTimeAsync(600);
    // Photos: automatic; thumbnails are counted where Vinted renders them (outside the form).
    expect(document.querySelectorAll('[data-testid^="image-wrapper-"]')).toHaveLength(2);
    expect(prefill.status).toEqual({ pageOk: true, title: "ready", description: "ready", photos: { requested: 2, attached: 2 } });
    // Text: nothing typed for the user…
    expect(seen.title).toEqual([]);
    expect((document.querySelector('[name="title"]') as HTMLInputElement).value).toBe("");
    const title = pasteButton("title")!;
    expect(title.closest(".web_ui__Input__content")).not.toBeNull();
    expect(title.closest(".web_ui__Input__content")!.getAttribute("style")).toContain("position: relative");
    expect(title.style.position).toBe("absolute");
    expect(title.style.right).toBe("8px");
    expect(title.getAttribute("aria-label")).toMatch(/titre|title/i);
    expect(title.querySelector("svg")).not.toBeNull();
    // …until they tap the icon: native setter + input/change events, then the status says so.
    title.click();
    expect(seen.title.at(-1)).toBe("Chemise blanche");
    expect(prefill.status?.title).toBe("filled");
    expect(prefill.status?.description).toBe("ready");
    pasteButton("description")!.click();
    expect(seen.description.at(-1)).toBe("Coton, très bon état.");
    expect(prefill.status?.description).toBe("filled");
    expect(submit).not.toHaveBeenCalled();
    expect(window.__aivPrefill).toBeUndefined(); // createPrefill does not touch globals; entry.ts does
  });

  it("mounts one icon per field even when run again, and the icon pastes the latest payload", async () => {
    mountForm();
    const prefill = createPrefill(window, VINTED_SELECTORS);
    prefill.run(payload);
    prefill.run({ ...payload, title: "Nouveau titre" });
    await vi.advanceTimersByTimeAsync(600);
    expect(document.querySelectorAll('button[data-aiv-paste="title"]')).toHaveLength(1);
    pasteButton("title")!.click();
    expect((document.querySelector('[name="title"]') as HTMLInputElement).value).toBe("Nouveau titre");
  });

  it("uses fallback selectors and reports missing fields", async () => {
    mountForm({ withDescription: false });
    const selectors: VintedSelectors = { ...VINTED_SELECTORS, titleInput: ['input[name="nope"]', ...VINTED_SELECTORS.titleInput] };
    const prefill = createPrefill(window, selectors);
    prefill.run(payload);
    await vi.advanceTimersByTimeAsync(600);
    expect(prefill.status?.title).toBe("ready");
    expect(prefill.status?.description).toBe("not_found");
    expect(pasteButton("description")).toBeNull();
  });

  it("waits for the form to render, then reports pageOk=false and does nothing outside the sell form", async () => {
    document.body.innerHTML = "<main><h1>Vinted</h1></main>";
    const prefill = createPrefill(window, VINTED_SELECTORS);
    prefill.run(payload);
    // Undecided while Vinted may still be rendering the form: the host keeps polling.
    expect(prefill.status).toBeNull();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(prefill.status).toBeNull();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(prefill.status).toEqual({ pageOk: false, title: "not_found", description: "not_found", photos: { requested: 2, attached: 0 } });
  });

  it("fills a form that appears after the run (client-side routing renders it after the load event)", async () => {
    document.body.innerHTML = "<main><h1>Vinted</h1></main>";
    const prefill = createPrefill(window, VINTED_SELECTORS);
    prefill.run(payload);
    await vi.advanceTimersByTimeAsync(1_000);
    const { seen } = mountForm();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(prefill.status).toEqual({ pageOk: true, title: "ready", description: "ready", photos: { requested: 2, attached: 2 } });
    pasteButton("title")!.click();
    expect(seen.title.at(-1)).toBe("Chemise blanche");
  });

  it("a run while waiting replaces the payload and keeps a single wait", async () => {
    document.body.innerHTML = "<main><h1>Vinted</h1></main>";
    const prefill = createPrefill(window, VINTED_SELECTORS);
    prefill.run(payload);
    await vi.advanceTimersByTimeAsync(1_000);
    prefill.run({ ...payload, title: "Nouveau titre" });
    mountForm();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(document.querySelectorAll('button[data-aiv-paste="title"]')).toHaveLength(1);
    pasteButton("title")!.click();
    expect((document.querySelector('[name="title"]') as HTMLInputElement).value).toBe("Nouveau titre");
  });

  it("does not count the page's other images (logo, avatar) as attached photos", async () => {
    mountForm();
    document.body.insertAdjacentHTML("afterbegin", '<header><img src="https://images1.vinted.net/t/avatar" alt="avatar"><img src="blob:x"></header>');
    const prefill = createPrefill(window, VINTED_SELECTORS);
    prefill.run(payload);
    await vi.advanceTimersByTimeAsync(600);
    expect(prefill.status?.photos).toEqual({ requested: 2, attached: 2 });
  });

  it("does not re-assign files or start a second poll while thumbnails are still loading", async () => {
    mountForm({ thumbnailDelayMs: 1000 });
    const prefill = createPrefill(window, VINTED_SELECTORS);
    prefill.run(payload);
    await vi.advanceTimersByTimeAsync(300);
    prefill.run(payload); // re-entrant while the first poll is in flight
    await vi.advanceTimersByTimeAsync(1500);
    expect(document.querySelectorAll('[data-testid^="image-wrapper-"]')).toHaveLength(2);
    expect(prefill.status?.photos).toEqual({ requested: 2, attached: 2 });
  });

  it("does not re-attach photos that are already there", async () => {
    mountForm();
    const prefill = createPrefill(window, VINTED_SELECTORS);
    prefill.run(payload);
    await vi.advanceTimersByTimeAsync(600);
    prefill.run(payload);
    await vi.advanceTimersByTimeAsync(600);
    expect(document.querySelectorAll('[data-testid^="image-wrapper-"]')).toHaveLength(2);
  });
});
