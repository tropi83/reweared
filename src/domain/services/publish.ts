import type { ProjectDocument } from "@/domain/models";

/** One photo sent to the injected script (base64 bytes, ≤ PUBLISH_LIMITS.photoBytes decoded). */
export interface PublishPhoto {
  name: string;
  mimeType: "image/jpeg" | "image/png";
  data: string;
}
export interface PublishPayload {
  title: string;
  description: string;
  photos: PublishPhoto[];
}
export type FieldFillResult = "filled" | "not_found" | "failed";
/** Written by the injected script to `window.__aivPrefill.status`, read back by Rust. */
export interface FillReport {
  pageOk: boolean;
  title: FieldFillResult;
  description: FieldFillResult;
  photos: { requested: number; attached: number };
}
export type PublishStage = "closed" | "login" | "browsing" | "form" | "filled";
export type PublishBlocker = "noPhotos" | "noCopy" | "desktopOnly";

/** Vinted's own form limits (title 100, description 5000, 20 photos) and our transfer cap per photo. */
export const PUBLISH_LIMITS = { title: 100, description: 5000, photos: 20, photoBytes: 4 * 1024 * 1024 } as const;
export const VINTED_SELL_PATH = "/items/new";

const VINTED_TLDS = [
  "com",
  "fr",
  "de",
  "es",
  "it",
  "nl",
  "be",
  "pl",
  "pt",
  "at",
  "lt",
  "cz",
  "sk",
  "lu",
  "hu",
  "ro",
  "se",
  "fi",
  "dk",
  "gr",
  "hr",
  "ie",
  "co.uk",
  "us",
];
const LOGIN_PROVIDER_HOSTS = new Set(["accounts.google.com", "www.facebook.com", "appleid.apple.com"]);

export function isVintedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, "");
  return VINTED_TLDS.some((tld) => h === `vinted.${tld}`);
}

function parse(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

export function isVintedLoginUrl(url: string): boolean {
  const u = parse(url);
  if (!u || u.protocol !== "https:") return false;
  if (LOGIN_PROVIDER_HOSTS.has(u.host)) return true;
  return isVintedHost(u.host) && /^\/member\/(login|signup)(\/|$)/.test(u.pathname);
}

export function isVintedSellFormUrl(url: string): boolean {
  const u = parse(url);
  return !!u && u.protocol === "https:" && isVintedHost(u.host) && u.pathname.replace(/\/$/, "") === VINTED_SELL_PATH;
}

export function stageForUrl(url: string | undefined): Exclude<PublishStage, "filled"> {
  if (url === undefined) return "closed";
  if (isVintedSellFormUrl(url)) return "form";
  if (isVintedLoginUrl(url)) return "login";
  return "browsing";
}

const FIELD_RESULTS: ReadonlySet<string> = new Set(["filled", "not_found", "failed"]);

export function isFillReport(value: unknown): value is FillReport {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const photos = v.photos as Record<string, unknown> | undefined;
  return (
    typeof v.pageOk === "boolean" &&
    FIELD_RESULTS.has(String(v.title)) &&
    FIELD_RESULTS.has(String(v.description)) &&
    !!photos &&
    typeof photos.requested === "number" &&
    typeof photos.attached === "number"
  );
}

/** Marked photos in posting order: the original first, then generations by creation time; unknown ids dropped, capped. */
export function orderedPhotoIds(doc: ProjectDocument): string[] {
  const assets = doc.toPost.map((id) => doc.images[id]).filter((a): a is NonNullable<typeof a> => !!a);
  assets.sort((a, b) => (a.kind === b.kind ? a.createdAt.localeCompare(b.createdAt) : a.kind === "original" ? -1 : 1));
  return assets.slice(0, PUBLISH_LIMITS.photos).map((a) => a.id);
}

export function canPost(doc: ProjectDocument | null | undefined, platform: { desktop: boolean }): { ok: boolean; reasons: PublishBlocker[] } {
  const reasons: PublishBlocker[] = [];
  if (!doc || orderedPhotoIds(doc).length === 0) reasons.push("noPhotos");
  const copy = doc?.project.copy;
  if (!copy || !copy.title.trim() || !copy.description.trim()) reasons.push("noCopy");
  if (!platform.desktop) reasons.push("desktopOnly");
  return { ok: reasons.length === 0, reasons };
}
