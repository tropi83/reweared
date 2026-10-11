import type { LoggerOptions } from "pino";
import { redact } from "@aiv/domain/lib/redact";

/** Paths pino replaces whatever the serializers let through (defence in depth). */
const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'res.headers["set-cookie"]',
  'res.headers["set-auth-token"]',
  "headers.authorization",
  "headers.cookie",
];

/** Request URL without its query string: verification and reset links carry tokens there. */
export function pathOnly(url: string | undefined): string {
  if (!url) return "";
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

/** One redacted line for an error and its causes (drizzle wraps the driver error that names the real problem). */
export function describeError(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; current !== undefined && current !== null && depth < 4; depth++) {
    parts.push(current instanceof Error ? `${current.name}: ${current.message.split("\n")[0]}` : String(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  return redact(parts.join(" <- caused by "));
}

interface LoggedRequest {
  method?: string;
  url?: string;
  ip?: string;
}

interface LoggedError {
  name?: string;
  message?: string;
  code?: string;
  statusCode?: number;
}

/**
 * pino options for Fastify. Requests are logged as method + path + client IP only (no headers, no query, no
 * body); every string argument and error message goes through the shared `redact()`; images, prompts and
 * full emails are never passed to the logger in the first place.
 */
export function loggerOptions(level: string): LoggerOptions {
  return {
    level,
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    serializers: {
      req: (req: LoggedRequest) => ({ method: req.method, url: pathOnly(req.url), ip: req.ip }),
      err: (err: LoggedError) => ({
        type: err.name,
        message: redact(String(err.message ?? "")),
        ...(err.code ? { code: err.code } : {}),
        ...(err.statusCode ? { statusCode: err.statusCode } : {}),
      }),
    },
    hooks: {
      logMethod(args, method) {
        method.apply(this, args.map((arg) => (typeof arg === "string" ? redact(arg) : arg)) as Parameters<typeof method>);
      },
    },
  };
}
