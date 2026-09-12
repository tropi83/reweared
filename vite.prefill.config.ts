import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

/** Builds the script injected into the Vinted window (see docs/superpowers/specs/2026-09-12-vinted-publish-design.md §5). */
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  publicDir: false, // do not copy public/ (favicon…) next to the script
  build: {
    lib: { entry: "src/infrastructure/publish/vinted/entry.ts", formats: ["iife"], name: "__aivPrefillBundle", fileName: () => "vinted-prefill.js" },
    outDir: "src-tauri/scripts",
    emptyOutDir: false,
    minify: false,
    sourcemap: false,
    target: "es2020",
  },
});
