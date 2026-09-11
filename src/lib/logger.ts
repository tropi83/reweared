/**
 * Minimal logger with credential redaction. Everything logged anywhere in the app must go
 * through here so API keys, bearer tokens and refresh tokens never reach the console or
 * diagnostics. Images and prompts are never logged either.
 */

const SECRET_PATTERNS: RegExp[] = [
  /AIza[0-9A-Za-z_-]{20,}/g, // Google API keys
  /ya29\.[0-9A-Za-z_-]+/g, // Google OAuth access tokens
  /1\/\/[0-9A-Za-z_-]{20,}/g, // Google refresh tokens
  /Bearer\s+[0-9A-Za-z._-]+/gi,
  /("?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|x-goog-api-key|client[_-]?secret)"?\s*[:=]\s*)("?)[^",\s}]+\2/gi,
];

export function redact(input: string): string {
  let out = input;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match, prefix: string | undefined) =>
      typeof prefix === "string" && match.startsWith(prefix) ? `${prefix}[REDACTED]` : "[REDACTED]",
    );
  }
  return out;
}

function fmt(value: unknown): string {
  if (typeof value === "string") return redact(value);
  if (value instanceof Error) return redact(`${value.name}: ${value.message}`);
  try {
    return redact(JSON.stringify(value));
  } catch {
    return "[unserializable]";
  }
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  scope: string;
  message: string;
}

const MAX_ENTRIES = 300;
const entries: LogEntry[] = [];

function push(level: LogLevel, scope: string, args: unknown[]) {
  const message = args.map(fmt).join(" ");
  entries.push({ ts: new Date().toISOString(), level, scope, message });
  if (entries.length > MAX_ENTRIES) entries.shift();
  if (import.meta.env.DEV || level === "warn" || level === "error") {
    const fn = level === "debug" ? console.debug : level === "info" ? console.info : level === "warn" ? console.warn : console.error;
    fn(`[${scope}] ${message}`);
  }
}

export function createLogger(scope: string) {
  return {
    debug: (...args: unknown[]) => push("debug", scope, args),
    info: (...args: unknown[]) => push("info", scope, args),
    warn: (...args: unknown[]) => push("warn", scope, args),
    error: (...args: unknown[]) => push("error", scope, args),
  };
}

/** Recent redacted log entries, for the Diagnostics panel. */
export function getRecentLogs(): readonly LogEntry[] {
  return entries;
}
