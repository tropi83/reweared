import { createPrefill } from "./prefill";
import { VINTED_SELECTORS } from "./selectors";

declare global {
  interface Window {
    __aivPrefill?: ReturnType<typeof createPrefill>;
  }
}

// Idempotent: Rust may evaluate the bundle before every `run`.
window.__aivPrefill ??= createPrefill(window, VINTED_SELECTORS);
