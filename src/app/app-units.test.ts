import { describe, expect, it } from "vitest";
import { getLocale, setLocale, t } from "@/i18n";
import { en } from "@/i18n/en";
import { fr } from "@/i18n/fr";
import { navigate, toHash, useRoute } from "./router";
import { renderHook, act } from "@testing-library/react";
import { useToastStore } from "./stores/toast-store";
import { useUiStore } from "./stores/ui-store";
import { useComposerStore } from "./stores/composer-store";

describe("i18n", () => {
  it("interpolates and falls back to English for missing French keys", () => {
    setLocale("en");
    expect(t("generation.variation", { index: 3 })).toBe("Variation 3");
    setLocale("fr");
    expect(getLocale()).toBe("fr");
    expect(t("generation.variation", { index: 3 })).toBe("Variation 3");
    expect(t("nav.settings")).toBe("Réglages");
    expect(t("app.name")).toBe(en["app.name"]);
    setLocale("en");
  });

  it("every French key exists in English (no orphan translations)", () => {
    for (const key of Object.keys(fr)) expect(key in en, key).toBe(true);
  });

  it("every error code has a user-facing message", () => {
    for (const code of ["AUTH_REQUIRED", "RATE_LIMITED", "QUOTA_EXCEEDED", "CONTENT_REJECTED", "NO_IMAGE_RETURNED", "STORAGE_ERROR", "UNKNOWN_ERROR"]) {
      expect(en[`error.${code}` as keyof typeof en]).toBeTruthy();
    }
  });
});

describe("router", () => {
  it("serializes and parses routes", () => {
    expect(toHash({ name: "home" })).toBe("#/");
    expect(toHash({ name: "listing", id: "prj_1" })).toBe("#/listing/prj_1");
    expect(toHash({ name: "settings", section: "providers" })).toBe("#/settings/providers");
    const { result } = renderHook(() => useRoute());
    act(() => navigate({ name: "settings", section: "storage" }));
    expect(result.current).toEqual({ name: "settings", section: "storage" });
    act(() => navigate({ name: "listing", id: "prj_2" }));
    expect(result.current).toEqual({ name: "listing", id: "prj_2" });
    expect(location.hash).toBe("#/listing/prj_2");
    act(() => navigate({ name: "home" }, true));
    expect(result.current).toEqual({ name: "home" });
  });

  it("still opens the old #/project/:id hashes (bookmarks from before the rename)", () => {
    const { result } = renderHook(() => useRoute());
    act(() => {
      location.hash = "#/project/prj_3";
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(result.current).toEqual({ name: "listing", id: "prj_3" });
  });
});

describe("ui store", () => {
  it("handles additive and exclusive selection", () => {
    const ui = useUiStore.getState();
    ui.clearSelection();
    ui.toggleSelected("a");
    ui.toggleSelected("b");
    expect([...useUiStore.getState().selection]).toEqual(["a", "b"]);
    ui.toggleSelected("a");
    expect([...useUiStore.getState().selection]).toEqual(["b"]);
    ui.toggleSelected("c", false);
    expect([...useUiStore.getState().selection]).toEqual(["c"]);
    ui.selectMany(["x", "y"]);
    expect(useUiStore.getState().selection.size).toBe(2);
    ui.openLightbox("x");
    ui.setCompareMode(true);
    ui.closeLightbox();
    expect(useUiStore.getState().lightboxAssetId).toBeNull();
    expect(useUiStore.getState().compareMode).toBe(false);
  });

  it("leaveListing drops the per-listing state (selection, viewer, compare) and keeps the rest", () => {
    const ui = useUiStore.getState();
    ui.selectMany(["x"]);
    ui.openLightbox("x");
    ui.setCompareMode(true);
    ui.setFilter("toPost");
    ui.leaveListing();
    expect(useUiStore.getState()).toMatchObject({ selection: new Set(), lightboxAssetId: null, compareMode: false, filter: "toPost" });
    ui.setFilter("all");
  });
});

describe("composer store", () => {
  it("takes the saved format as the default", () => {
    const c = useComposerStore.getState();
    c.setAspectRatio("1:1");
    c.applyDefaults({ defaultAspectRatio: "3:4" });
    expect(useComposerStore.getState().aspectRatio).toBe("3:4");
  });

  it("goes back to the original photo when another listing opens", () => {
    const c = useComposerStore.getState();
    c.bindListing("lst_a");
    c.setSource("img_1");
    c.bindListing("lst_a");
    expect(useComposerStore.getState().sourceImageId).toBe("img_1");
    c.bindListing("lst_b");
    expect(useComposerStore.getState().sourceImageId).toBeNull();
  });
});

describe("toast store", () => {
  it("keeps at most four toasts and dismisses", () => {
    const store = useToastStore.getState();
    for (let i = 0; i < 6; i++) store.push("info", `m${i}`, undefined, 0);
    expect(useToastStore.getState().toasts).toHaveLength(4);
    const id = useToastStore.getState().toasts[0]!.id;
    store.dismiss(id);
    expect(useToastStore.getState().toasts.some((t) => t.id === id)).toBe(false);
  });
});
