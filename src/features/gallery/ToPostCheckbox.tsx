import { Check, Send } from "lucide-react";
import { useListingsStore } from "@/app/stores/listings-store";
import { useT } from "@/i18n";
import { cn } from "@/lib/cn";

interface Props {
  assetId: string;
  checked: boolean;
  className?: string;
}

/**
 * Marks a photo “To post” straight from its tile: a labelled chip (“To post” + check) in the corner of
 * the image, so it is never mistaken for the tile's plain selection checkbox (top-left, for
 * download / delete). Always visible on touch screens (there is no hover to reveal it), hover-revealed
 * with a mouse unless checked. Callers put it in a `group` container for the hover reveal.
 */
export function ToPostCheckbox({ assetId, checked, className }: Props) {
  const t = useT();
  const toggleToPost = useListingsStore((s) => s.toggleToPost);
  const label = t(checked ? "gallery.unToPost" : "gallery.toPost");
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      title={label}
      data-to-post
      onClick={(e) => {
        e.stopPropagation();
        toggleToPost(assetId);
      }}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-full border px-2 text-[11px] font-semibold whitespace-nowrap shadow-sm backdrop-blur transition-[opacity,background-color,border-color]",
        "focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        checked
          ? "border-accent bg-accent text-accent-fg opacity-100"
          : "border-white/70 bg-black/50 text-white opacity-0 group-hover:opacity-100 hover:bg-black/70 pointer-coarse:opacity-100",
        className,
      )}
    >
      {checked ? <Check className="size-3.5" strokeWidth={3} /> : <Send className="size-3" />}
      {t("gallery.toPost")}
    </button>
  );
}
