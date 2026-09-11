import { isTauri } from "@/infrastructure/platform/capabilities";

/**
 * Single HTTP entry point for every outbound request.
 *
 * - Web: the browser's fetch (CORS applies; Google's Gemini endpoints allow it with API keys).
 * - Tauri: the `@tauri-apps/plugin-http` fetch, which runs in Rust and is restricted by the
 *   URL allowlist declared in src-tauri/capabilities/default.json.
 *
 * Only hosts listed in ALLOWED_HOSTS may be contacted, as a defence in depth against any future
 * bug that would build a URL from untrusted data.
 */
export const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  "generativelanguage.googleapis.com",
  "oauth2.googleapis.com",
  "accounts.google.com",
  "cloudresourcemanager.googleapis.com",
  "www.googleapis.com",
  "api.cloudflare.com",
]);

/**
 * Hosts the user configured explicitly (their own Cloudflare Worker). Only https hosts that look
 * like a Worker endpoint are accepted; on desktop the Tauri http scope must also allow them
 * (`https://*.workers.dev/*` is allowed out of the box).
 */
const userHosts = new Set<string>();

export function allowHost(host: string): void {
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host) || host === "localhost" || /^127\./.test(host)) {
    throw new Error("Refusing to allowlist this host");
  }
  userHosts.add(host.toLowerCase());
}

export function isHostAllowed(host: string): boolean {
  return ALLOWED_HOSTS.has(host) || userHosts.has(host.toLowerCase());
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

let override: FetchLike | undefined;

/** Test hook: replaces the underlying fetch. */
export function __setFetchOverride(fn: FetchLike | undefined) {
  override = fn;
}

async function resolveFetch(): Promise<FetchLike> {
  if (override) return override;
  if (isTauri()) {
    const mod = await import("@tauri-apps/plugin-http");
    return (input, init) => mod.fetch(input, init);
  }
  return (input, init) => globalThis.fetch(input, init);
}

export async function httpFetch(url: string, init?: RequestInit): Promise<Response> {
  const parsed = new URL(url);
  const host = parsed.host;
  if (parsed.protocol !== "https:" || !isHostAllowed(host)) {
    throw new Error(`Refusing to contact non-allowlisted host: ${host}`);
  }
  const fetchFn = await resolveFetch();
  return fetchFn(url, init);
}
