import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import noFrenchIdentifiers from "./tools/eslint-rules/no-french-identifiers.js";

/** Repo-local rules (tools/eslint-rules). */
const local = { rules: { "no-french-identifiers": noFrenchIdentifiers } };

export default tseslint.config(
  { ignores: ["dist", "**/dist", "src-tauri", "src-tauri/scripts/**", "node_modules"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}", "packages/*/src/**/*.ts", "apps/*/src/**/*.ts", "apps/*/test/**/*.ts"],
    plugins: { "react-hooks": reactHooks, local },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      // Identifiers are English; French lives in comments and i18n labels.
      "local/no-french-identifiers": "error",
    },
  },
  {
    // Shared packages (@aiv/domain, @aiv/contracts) and the server run in Node (ADR 0001): no app, UI, Tauri or storage code, no browser globals.
    files: ["packages/*/src/**/*.ts", "apps/server/src/**/*.ts", "apps/server/test/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/*", "react", "react-*", "@tauri-apps/*", "zustand", "idb", "@tanstack/*", "fflate", "lucide-react"],
              message: "Shared packages and the server run in Node: no app, UI, Tauri or client storage imports.",
            },
          ],
        },
      ],
      "no-restricted-globals": ["error", "window", "document", "localStorage", "sessionStorage", "indexedDB", "FileReader", "createImageBitmap", "navigator"],
    },
  },
  {
    files: ["tools/**/*.{js,mjs}", "scripts/**/*.{js,mjs}", "apps/*/*.mjs"],
    // Node scripts: the handful of globals they use, without pulling the `globals` package in.
    languageOptions: { globals: { process: "readonly", console: "readonly", URL: "readonly", Buffer: "readonly", fetch: "readonly" } },
    plugins: { local },
    rules: { "local/no-french-identifiers": "error" },
  },
);
