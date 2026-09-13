import { useSyncExternalStore } from "react";

export type Route = { name: "home" } | { name: "listing"; id: string } | { name: "settings"; section?: string } | { name: "recipes" };

function parse(hash: string): Route {
  const path = hash.replace(/^#\/?/, "");
  const [head, ...rest] = path.split("/");
  switch (head) {
    case "listing":
    case "project": // hashes from before the "project" → "listing" rename (bookmarks, history)
      return rest[0] ? { name: "listing", id: rest[0] } : { name: "home" };
    case "settings":
      return rest[0] ? { name: "settings", section: rest[0] } : { name: "settings" };
    case "recipes":
      return { name: "recipes" };
    default:
      return { name: "home" };
  }
}

export function toHash(route: Route): string {
  switch (route.name) {
    case "listing":
      return `#/listing/${route.id}`;
    case "settings":
      return route.section ? `#/settings/${route.section}` : "#/settings";
    case "recipes":
      return "#/recipes";
    default:
      return "#/";
  }
}

let current: Route = typeof location !== "undefined" ? parse(location.hash) : { name: "home" };
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => {
    current = parse(location.hash);
    listeners.forEach((l) => l());
  });
}

export function navigate(route: Route, replace = false) {
  const hash = toHash(route);
  if (location.hash === hash) return;
  if (replace) history.replaceState(null, "", hash);
  else history.pushState(null, "", hash);
  current = parse(hash);
  listeners.forEach((l) => l());
}

/** The current route outside React (stores, actions). */
export function currentRoute(): Route {
  return current;
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}
