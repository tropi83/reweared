/**
 * Single HTTP entry point of every provider adapter.
 *
 * Only hosts listed in ALLOWED_HOSTS (plus hosts registered with `allowHost`, e.g. a user's own Cloudflare
 * Worker) may be contacted, over https — a defence in depth against any bug that would build a URL from
 * untrusted data. The actual fetch is supplied by the runtime: the app installs the Tauri plugin's fetch on
 * desktop/phones (restricted again by the Tauri http scope) or the browser's; the server worker uses Node's.
 */
export const ALLOWED_HOSTS: ReadonlySet<string> = new Set([
  "generativelanguage.googleapis.com",
  "oauth2.googleapis.com",
  "accounts.google.com",
  "cloudresourcemanager.googleapis.com",
  "www.googleapis.com",
  "api.cloudflare.com",
]);

const userHosts = new Set<string>();

/** Allows a host the user configured (their Cloudflare Worker). Refuses loopback and anything that is not a host. */
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

let resolver: () => Promise<FetchLike> = async () => (input, init) => globalThis.fetch(input, init);
let override: FetchLike | undefined;

/** Installs the runtime's fetch (Tauri plugin, browser, Node). Called once at startup. */
export function setFetchResolver(resolve: () => Promise<FetchLike>): void {
  resolver = resolve;
}

/** Test hook: replaces the underlying fetch. */
export function __setFetchOverride(fn: FetchLike | undefined): void {
  override = fn;
}

export async function httpFetch(url: string, init?: RequestInit): Promise<Response> {
  const parsed = new URL(url);
  const host = parsed.host;
  if (parsed.protocol !== "https:" || !isHostAllowed(host)) {
    throw new Error(`Refusing to contact non-allowlisted host: ${host}`);
  }
  const fetchFn = override ?? (await resolver());
  return fetchFn(url, init);
}
