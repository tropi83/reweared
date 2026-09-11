import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

const base =
  "w-full rounded-lg border border-border bg-bg-elevated px-3 text-sm text-fg placeholder:text-fg-subtle transition-[border,box-shadow] focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(base, "h-9", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(base, "resize-none py-2 leading-relaxed", className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <div className="relative">
      <select ref={ref} className={cn(base, "h-9 appearance-none pr-8", className)} {...rest}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
    </div>
  );
});

export function Label({ children, htmlFor, className, hint }: { children: React.ReactNode; htmlFor?: string; className?: string; hint?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn("block text-xs font-medium text-fg-muted", className)}>
      {children}
      {hint && <span className="ml-1 font-normal text-fg-subtle">{hint}</span>}
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  id,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  id?: string;
  disabled?: boolean;
}) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2.5 select-none", disabled && "pointer-events-none opacity-50")}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full border transition-colors",
          checked ? "border-accent bg-accent" : "border-border-strong bg-bg-sunken",
        )}
      >
        <span
          className={cn("absolute top-0.5 size-3.5 rounded-full bg-white shadow transition-transform", checked ? "left-0 translate-x-4.5" : "left-0.5")}
          style={{ transform: checked ? "translateX(18px)" : undefined }}
        />
      </button>
      {label && <span className="text-sm">{label}</span>}
    </label>
  );
}
