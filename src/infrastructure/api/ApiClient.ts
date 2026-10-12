import type { z } from "zod";
import { errorBody } from "@aiv/contracts/common";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** An error answered by the API (`{ code, message }`), or a network failure (`NETWORK_ERROR`). */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiClientOptions {
  /** `VITE_API_ORIGIN`: "/" (same origin) or an absolute origin. Every request goes there and nowhere else. */
  origin: string;
  fetch: FetchLike;
  /** Desktop/phone apps: the session token from the OS keychain. The web app uses cookies and returns null. */
  bearer: () => Promise<string | null>;
  /** Called with the token the server returns at sign-in (`set-auth-token`), to keep it in the keychain. */
  onSessionToken?: (token: string) => Promise<void>;
  /** Called when the API answers 401: the session ended. */
  onUnauthenticated?: () => void;
}

export interface RequestOptions<T> {
  json?: unknown;
  body?: FormData;
  schema?: z.ZodType<T>;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

/**
 * The app's only way to the API: fixed origin, cookie or bearer authentication, responses parsed with the shared
 * `@aiv/contracts` schemas, errors turned into `ApiError` with the server's code (never a raw body in the UI).
 */
export class ApiClient {
  constructor(private readonly options: ApiClientOptions) {}

  url(path: string): string {
    if (!path.startsWith("/api/")) throw new Error("API paths start with /api/");
    const origin = this.options.origin === "/" ? "" : this.options.origin.replace(/\/$/, "");
    return `${origin}${path}`;
  }

  async headers(extra: Record<string, string> = {}): Promise<Record<string, string>> {
    const token = await this.options.bearer();
    return { ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra };
  }

  async request<T = unknown>(method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", path: string, opts: RequestOptions<T> = {}): Promise<T> {
    const headers = await this.headers({ ...(opts.json !== undefined ? { "content-type": "application/json" } : {}), ...opts.headers });
    let response: Response;
    try {
      response = await this.options.fetch(this.url(path), {
        method,
        headers,
        // Same-origin cookies for the web app; the Tauri apps authenticate with the bearer header only.
        credentials: headers.authorization ? "omit" : "include",
        ...(opts.json !== undefined ? { body: JSON.stringify(opts.json) } : opts.body ? { body: opts.body } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
    } catch (error) {
      if (opts.signal?.aborted) throw error;
      throw new ApiError("NETWORK_ERROR", "The server cannot be reached. Check your connection.", 0);
    }
    const token = response.headers.get("set-auth-token");
    if (token && this.options.onSessionToken) await this.options.onSessionToken(token);
    if (!response.ok) {
      if (response.status === 401) this.options.onUnauthenticated?.();
      const parsed = errorBody.safeParse(await response.json().catch(() => null));
      throw parsed.success
        ? new ApiError(parsed.data.code, parsed.data.message, response.status)
        : new ApiError("UNKNOWN_ERROR", "Unexpected error.", response.status);
    }
    if (response.status === 204) return undefined as T;
    const contentType = response.headers.get("content-type") ?? "";
    const data: unknown = contentType.includes("application/json") ? await response.json() : await response.blob();
    return opts.schema ? opts.schema.parse(data) : (data as T);
  }

  get<T>(path: string, schema?: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
    return this.request<T>("GET", path, { ...(schema ? { schema } : {}), ...(signal ? { signal } : {}) });
  }
}
