import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPrefill } from "./prefill";
import { VINTED_SELECTORS, type VintedSelectors } from "./selectors";

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** Minimal stand-in for Vinted's React-controlled sell form. */
function mountForm({ withDescription = true } = {}) {
  document.body.innerHTML = `
    <form data-testid="item-upload-form">
      <input type="file" accept="image/*" multiple data-testid="photo-input" />
      <div data-testid="photo-thumbnails"></div>
      <input name="title" data-testid="title--input" value="" />
      ${withDescription ? '<textarea name="description" data-testid="description--input"></textarea>' : ""}
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
    const box = document.querySelector('[data-testid="photo-thumbnails"]')!;
    for (const f of Array.from(photoInput.files ?? [])) box.insertAdjacentHTML("beforeend", `<img data-testid="photo-thumbnail" alt="${f.name}">`);
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

  it("fills title, description and photos through native setters + events, never submits", async () => {
    const { seen, submit } = mountForm();
    const prefill = createPrefill(window, VINTED_SELECTORS);
    prefill.run(payload);
    await vi.advanceTimersByTimeAsync(600);
    expect(seen.title.at(-1)).toBe("Chemise blanche");
    expect(seen.description.at(-1)).toBe("Coton, très bon état.");
    expect(prefill.status).toEqual({ pageOk: true, title: "filled", description: "filled", photos: { requested: 2, attached: 2 } });
    expect(submit).not.toHaveBeenCalled();
    expect(window.__aivPrefill).toBeUndefined(); // createPrefill does not touch globals; entry.ts does
  });

  it("uses fallback selectors and reports missing fields", async () => {
    mountForm({ withDescription: false });
    const selectors: VintedSelectors = { ...VINTED_SELECTORS, titleInput: ['input[name="nope"]', ...VINTED_SELECTORS.titleInput] };
    const prefill = createPrefill(window, selectors);
    prefill.run(payload);
    await vi.advanceTimersByTimeAsync(600);
    expect(prefill.status?.title).toBe("filled");
    expect(prefill.status?.description).toBe("not_found");
  });

  it("reports pageOk=false and does nothing outside the sell form", () => {
    document.body.innerHTML = "<main><h1>Vinted</h1></main>";
    const prefill = createPrefill(window, VINTED_SELECTORS);
    prefill.run(payload);
    expect(prefill.status).toEqual({ pageOk: false, title: "not_found", description: "not_found", photos: { requested: 2, attached: 0 } });
  });

  it("does not re-attach photos that are already there", async () => {
    mountForm();
    const prefill = createPrefill(window, VINTED_SELECTORS);
    prefill.run(payload);
    await vi.advanceTimersByTimeAsync(600);
    prefill.run(payload);
    await vi.advanceTimersByTimeAsync(600);
    expect(document.querySelectorAll('[data-testid="photo-thumbnail"]')).toHaveLength(2);
  });
});
