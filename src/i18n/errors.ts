import type { GenerationErrorCode } from "@/domain/models";
import { QUOTA_RESET_TIME_ZONE } from "@/domain/services/usage-tracker";
import { en } from "./en";
import { t, type MessageKey } from "./index";

/**
 * User-facing message for an error, preferring a provider-specific wording
 * (`error.<providerId>.<code>`) over the generic one (`error.<code>`).
 * Quota messages get the reset time in the user's local time plus the remaining delay.
 */
export function errorMessage(error: { code: GenerationErrorCode }, providerId?: string, now = new Date()): string {
  const specific = providerId ? `error.${providerId}.${error.code}` : undefined;
  const key = (specific && specific in en ? specific : `error.${error.code}`) as MessageKey;
  const zone = providerId ? QUOTA_RESET_TIME_ZONE[providerId] : undefined;
  const reset = zone ? nextMidnightIn(zone, now) : undefined;
  return t(key, reset ? { resetLocal: formatLocalTime(reset), resetIn: formatDuration(reset.getTime() - now.getTime()) } : undefined);
}

/** Next 00:00 in `timeZone`, as an absolute instant. Falls back to UTC midnight if the engine cannot report the zone offset. */
export function nextMidnightIn(timeZone: string, now = new Date()): Date {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", timeZoneName: "longOffset" }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  }
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  const offsetMatch = /GMT([+-])(\d{2}):?(\d{2})?/.exec(get("timeZoneName"));
  const offsetMinutes = offsetMatch ? (offsetMatch[1] === "-" ? -1 : 1) * (Number(offsetMatch[2]) * 60 + Number(offsetMatch[3] ?? 0)) : 0;
  // Local midnight of the *next* day in that zone = UTC midnight of that date shifted by the zone offset.
  return new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0) - offsetMinutes * 60_000);
}

function formatLocalTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** "5 h 20 min" / "12 min" — the same in English and French. */
export function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h${m > 0 ? ` ${String(m).padStart(2, "0")} min` : ""}` : `${m} min`;
}
