import type { ThemePreference } from "@/domain/models";

const media = typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
let preference: ThemePreference = "system";

function resolve(): "dark" | "light" {
  if (preference === "system") return media?.matches ? "dark" : "light";
  return preference;
}

function apply() {
  document.documentElement.dataset.theme = resolve();
}

media?.addEventListener("change", apply);

export function applyTheme(next: ThemePreference) {
  preference = next;
  apply();
}
