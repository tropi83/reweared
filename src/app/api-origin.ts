/**
 * The API the app works with (`VITE_API_ORIGIN` at build time): "/" — the default — for the web bundle served on the
 * API's own origin (and `pnpm dev` through the Vite proxy), the public https origin for the desktop and phone apps.
 */
export const API_ORIGIN: string = import.meta.env.VITE_API_ORIGIN?.trim() || "/";
