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
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, local },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      // Identifiers are English; French lives in comments and i18n labels.
      "local/no-french-identifiers": "error",
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
