import { describe, expect, it } from "vitest";
import { setLocale } from "@/i18n";
import { publishBarText } from "./publish-bar";
import type { PublishSession } from "./stores/publish-store";

const READY = { pageOk: true, title: "ready", description: "ready", photos: { requested: 3, attached: 2 } } as const;

describe("publishBarText", () => {
  it("words each step of the desktop session like the phone status line", () => {
    setLocale("en");
    const at = (session: Partial<PublishSession>) => publishBarText({ stage: "browsing", busy: false, ...session });
    expect(at({ stage: "login" })).toMatch(/^Sign in to Vinted/);
    expect(at({ stage: "browsing" })).toMatch(/^Open the sell form/);
    expect(at({ stage: "form" })).toBe("Filling the form…");
    expect(at({ stage: "form", busy: true })).toBe("Filling the form…");
    expect(at({ stage: "filled", report: READY })).toBe("Photos 2/3 · Title ⧉ · Description ⧉ — click the ⧉ icons to paste the text.");
    expect(at({ stage: "filled", report: { ...READY, title: "filled", description: "not_found", photos: { requested: 3, attached: 3 } } })).toBe(
      "Title ✓ · Description ✗ · Photos 3/3 — check, then click “Add” yourself.",
    );
    expect(at({ stage: "form", report: { ...READY, pageOk: false } })).toBe("This page is not the sell form.");
    expect(at({ stage: "form", error: { code: "TIMEOUT", message: "", retryable: false } })).toMatch(/did not answer/);
    // A report from the form does not follow the user to another page.
    expect(at({ stage: "browsing", report: READY })).toMatch(/^Open the sell form/);
    setLocale("fr");
    expect(at({ stage: "login" })).toMatch(/^Connectez-vous/);
    setLocale("en");
  });
});
