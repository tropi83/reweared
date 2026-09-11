import { useEffect } from "react";
import { useProjectsStore } from "@/app/stores/projects-store";
import { useUiStore } from "@/app/stores/ui-store";

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

/**
 * Desktop shortcuts for the workspace (the lightbox handles its own while open):
 *  Ctrl/⌘+A select all results · Esc clear selection · Delete removes selection (confirmation shown by the bar).
 */
export function useWorkspaceShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUiStore.getState();
      if (ui.lightboxAssetId) return;
      if (isEditable(e.target)) return;
      const doc = useProjectsStore.getState().current;
      if (!doc) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        ui.selectMany(
          Object.values(doc.images)
            .filter((i) => i.kind === "generation")
            .map((i) => i.id),
        );
      } else if (e.key === "Escape" && ui.selection.size > 0) {
        ui.clearSelection();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
