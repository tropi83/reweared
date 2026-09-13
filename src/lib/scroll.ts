/** Scrolls `el` into view, smoothly unless the user asked for reduced motion. */
export function revealElement(el: Element | null | undefined, block: ScrollLogicalPosition = "center"): void {
  if (!el) return;
  const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block });
}
