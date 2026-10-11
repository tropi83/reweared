/** Prefixed, URL/filename-safe unique ids. */
/** `lst` = listing (ids created before 2026-09-13 carry the former `prj` prefix and stay valid). */
export function createId(prefix: "lst" | "img" | "gen" | "job" | "rcp"): string {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`;
  return `${prefix}_${uuid.replace(/-/g, "")}`;
}

/** Only ids produced by createId are accepted when building filesystem paths (path-traversal guard). */
export const SAFE_ID_PATTERN = /^[a-z]{3}_[a-f0-9]{8,64}$/;

export function assertSafeId(id: string): string {
  if (!SAFE_ID_PATTERN.test(id)) {
    throw new Error("Invalid identifier");
  }
  return id;
}

export function nowIso(): string {
  return new Date().toISOString();
}
