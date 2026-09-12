import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export interface SelectOption<V extends string = string> {
  value: V;
  label: ReactNode;
  /** Secondary line under the label. */
  description?: ReactNode;
  disabled?: boolean;
}

export interface SelectProps<V extends string = string> {
  id?: string;
  value: V;
  options: readonly SelectOption<V>[];
  onChange: (value: V) => void;
  /** Shown when `value` matches no option (e.g. empty string for "nothing chosen"). */
  placeholder?: ReactNode;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}

const MENU_GAP = 4;
const MENU_MAX_HEIGHT = 288;

/**
 * Themed replacement for the native <select>: the trigger is a button, the menu a listbox rendered
 * in a portal (so overflow-hidden/scrolling ancestors never clip it) and positioned with fixed
 * coordinates, flipping above the trigger when there is no room below. Inside a modal <dialog> the
 * menu is portalled into that dialog so it stays in the top layer.
 *
 * Keyboard: Enter / Space / ArrowDown open; ArrowUp/Down, Home/End move; Enter selects; Esc / Tab close;
 * typing a letter jumps to the next option starting with it.
 */
export function Select<V extends string = string>({ id, value, options, onChange, placeholder, disabled, className, "aria-label": ariaLabel }: SelectProps<V>) {
  const listId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  // Portal target, resolved when the menu opens: the enclosing modal <dialog> (top layer) or the body.
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const typeahead = useRef({ text: "", at: 0 });

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const place = useCallback(() => {
    const el = buttonRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - MENU_GAP - 8;
    const above = r.top - MENU_GAP - 8;
    const wanted = Math.min(MENU_MAX_HEIGHT, options.length * 36 + 8);
    const flip = below < wanted && above > below;
    const maxHeight = Math.max(120, Math.min(wanted, flip ? above : below));
    setPos({ top: flip ? r.top - MENU_GAP - maxHeight : r.bottom + MENU_GAP, left: r.left, width: r.width, maxHeight });
  }, [options.length]);

  const openMenu = useCallback(() => {
    if (disabled) return;
    setContainer(buttonRef.current?.closest("dialog") ?? document.body);
    place();
    setActive(selectedIndex >= 0 ? selectedIndex : options.findIndex((o) => !o.disabled));
    setOpen(true);
  }, [disabled, place, selectedIndex, options]);

  const close = useCallback((focusTrigger = true) => {
    setOpen(false);
    if (focusTrigger) buttonRef.current?.focus();
  }, []);

  const choose = (index: number) => {
    const opt = options[index];
    if (!opt || opt.disabled) return;
    if (opt.value !== value) onChange(opt.value);
    close();
  };

  // Keep the menu glued to the trigger while the page scrolls or resizes; close on outside interaction.
  useLayoutEffect(() => {
    if (!open) return;
    place();
    const onScroll = () => place();
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!buttonRef.current?.contains(target) && !listRef.current?.contains(target)) close(false);
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, place, close]);

  // Scroll the active option into view.
  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, active]);

  const move = (from: number, step: 1 | -1) => {
    let i = from;
    for (let n = 0; n < options.length; n++) {
      i = (i + step + options.length) % options.length;
      if (!options[i]?.disabled) return i;
    }
    return from;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        close();
        return;
      case "Tab":
        close(false);
        return;
      case "ArrowDown":
        e.preventDefault();
        setActive((a) => move(a, 1));
        return;
      case "ArrowUp":
        e.preventDefault();
        setActive((a) => move(a, -1));
        return;
      case "Home":
        e.preventDefault();
        setActive(move(-1, 1));
        return;
      case "End":
        e.preventDefault();
        setActive(move(0, -1));
        return;
      case "Enter":
      case " ":
        e.preventDefault();
        choose(active);
        return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      const state = typeahead.current;
      state.text = now - state.at < 600 ? state.text + e.key.toLowerCase() : e.key.toLowerCase();
      state.at = now;
      const start = state.text.length === 1 ? active : active - 1;
      for (let n = 1; n <= options.length; n++) {
        const i = (start + n + options.length) % options.length;
        const label = textOf(options[i]?.label);
        if (!options[i]?.disabled && label.toLowerCase().startsWith(state.text)) {
          setActive(i);
          return;
        }
      }
    }
  };

  const menu =
    open && pos && container
      ? createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-labelledby={id}
            tabIndex={-1}
            style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, maxHeight: pos.maxHeight }}
            className="fade-in z-50 overflow-y-auto rounded-lg border border-border bg-bg-elevated p-1 text-sm shadow-app"
          >
            {options.map((opt, i) => {
              const isSelected = i === selectedIndex;
              const isActive = i === active;
              return (
                <li
                  key={opt.value}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={opt.disabled || undefined}
                  data-index={i}
                  onPointerMove={() => !opt.disabled && setActive(i)}
                  onClick={() => choose(i)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 transition-colors",
                    opt.disabled ? "cursor-not-allowed text-fg-subtle" : isActive ? "bg-accent-soft text-fg" : "text-fg",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{opt.label}</div>
                    {opt.description && <div className="truncate text-xs text-fg-subtle">{opt.description}</div>}
                  </div>
                  {isSelected && <Check className="size-4 shrink-0 text-accent" aria-hidden />}
                </li>
              );
            })}
          </ul>,
          container,
        )
      : null;

  return (
    <>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onKeyDown}
        className={cn(
          "flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-bg-elevated pr-2.5 pl-3 text-left text-sm text-fg transition-[border,box-shadow] focus:border-accent focus:ring-2 focus:ring-ring focus:outline-none disabled:opacity-50",
          open && "border-accent ring-2 ring-ring",
          className,
        )}
      >
        <span className={cn("min-w-0 flex-1 truncate", !selected && "text-fg-subtle")}>{selected ? selected.label : placeholder}</span>
        <ChevronDown className={cn("size-4 shrink-0 text-fg-subtle transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {menu}
    </>
  );
}

function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (typeof node === "object" && "props" in node) return textOf((node as { props: { children?: ReactNode } }).props.children);
  return "";
}
