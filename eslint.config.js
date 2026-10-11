import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import noFrenchIdentifiers from "./tools/eslint-rules/no-french-identifiers.js";

/** Repo-local rules (tools/eslint-rules). */
const local = { rules: { "no-french-identifiers": noFrenchIdentifiers } };

export default tseslint.config(
  { ignores: ["dist", "src-tauri", "src-tauri/scripts/**", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}", "packages/*/src/**/*.ts"],
    plugins: { "react-hooks": reactHooks, local },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      // Identifiers are English; French lives in comments and i18n labels.
      "local/no-french-identifiers": "error",
    },
  },
  {
    // Shared packages (@aiv/domain, @aiv/contracts) run on the server too (ADR 0001): no app, UI, Tauri or storage code, no browser globals.
    files: ["packages/*/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/*", "react", "react-*", "@tauri-apps/*", "zustand", "idb", "@tanstack/*", "fflate", "lucide-react"],
              message: "Shared packages run on the server: no app, UI, Tauri or storage imports.",
            },
          ],
        },
      ],
      "no-restricted-globals": ["error", "window", "document", "localStorage", "sessionStorage", "indexedDB", "FileReader", "createImageBitmap", "navigator"],
    },
  },
  {
    files: ["tools/**/*.{js,mjs}", "scripts/**/*.{js,mjs}"],
    // Node scripts: the handful of globals they use, without pulling the `globals` package in.
    languageOptions: { globals: { process: "readonly", console: "readonly", URL: "readonly", Buffer: "readonly", fetch: "readonly" } },
    plugins: { local },
    rules: { "local/no-french-identifiers": "error" },
  },
);
