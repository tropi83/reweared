/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
    // `VITE_API_ORIGIN=/ pnpm dev`: the API is reached through this proxy, so its session cookies are same-origin
    // as in production behind Caddy (compose.dev.yaml trusts the :1420 origin).
    proxy: { "/api": { target: process.env.API_PROXY_TARGET ?? "http://localhost:8080" } },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
  test: {
    projects: [
      {
        extends: true as const,
        test: {
          name: "app",
          environment: "jsdom",
          globals: true,
          setupFiles: ["./src/test/setup.ts"],
          include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs", "tools/**/*.test.mjs"],
          css: false,
        },
      },
      // The shared domain runs in plain Node, without the app's aliases or DOM polyfills: the server imports it too.
      { test: { name: "domain", root: "./packages/domain", environment: "node", globals: true, include: ["src/**/*.test.ts"] } },
      { test: { name: "contracts", root: "./packages/contracts", environment: "node", globals: true, include: ["src/**/*.test.ts"] } },
      { test: { name: "providers", root: "./packages/providers", environment: "node", globals: true, include: ["src/**/*.test.ts"] } },
      // Server unit tests only; Docker-backed integration tests run with `pnpm test:integration`.
      { test: { name: "server", root: "./apps/server", environment: "node", globals: true, include: ["src/**/*.test.ts"] } },
    ],
  },
}));
