import { isTauri } from "@/infrastructure/platform/capabilities";
import { setFetchResolver, type FetchLike } from "@aiv/providers/http";

/**
 * The app's HTTP runtime for every outbound request (provider adapters, OAuth, project listing). The host
 * allowlist and `httpFetch` live in `@aiv/providers/http`, shared with the server worker; this module plugs in:
 *
 * - Web: the browser's fetch (CORS applies; Google's Gemini endpoints allow it with API keys).
 * - Tauri: the `@tauri-apps/plugin-http` fetch, which runs in Rust and is restricted again by the URL
 *   allowlist declared in src-tauri/capabilities/default.json.
 */
setFetchResolver(async (): Promise<FetchLike> => {
  if (isTauri()) {
    const mod = await import("@tauri-apps/plugin-http");
    return (input, init) => mod.fetch(input, init);
  }
  return (input, init) => globalThis.fetch(input, init);
});

export { allowHost, httpFetch, __setFetchOverride } from "@aiv/providers/http";
