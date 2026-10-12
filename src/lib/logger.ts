/**
 * Minimal logger with credential redaction (patterns shared with the server in `@aiv/domain/lib/redact`). Everything logged anywhere in the app must go
 * through here so API keys, bearer tokens and refresh tokens never reach the console or
 * diagnostics. Images and prompts are never logged either.
 */

import { redact } from "@aiv/domain/lib/redact";

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
