/**
 * `VITE_API_ORIGIN` set at build time: the app runs on the API (accounts, server storage, generation by the
 * platform). Unset: the local-first app, unchanged.
 */
export const API_ORIGIN: string | null = import.meta.env.VITE_API_ORIGIN?.trim() || null;

export const API_MODE: boolean = API_ORIGIN !== null;
