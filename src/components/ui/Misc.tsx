import { type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useToastStore } from "@/app/stores/toast-store";

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "success" | "warning" | "danger";
  className?: string;
}) {
  const tones = {
    neutral: "bg-bg-sunken text-fg-muted border-border",
    accent: "bg-accent-soft text-accent border-accent/30",
    success: "bg-success/10 text-success border-success/30",
    warning: "bg-warning/10 text-warning border-warning/30",
    danger: "bg-danger/10 text-danger border-danger/30",
  };
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2 py-0.5 text-[11px] leading-4 font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  size = "md",
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: ReactNode; disabled?: boolean; title?: string }>;
  ariaLabel: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("inline-flex flex-wrap gap-1 rounded-lg bg-bg-sunken p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-md font-medium transition-colors disabled:opacity-40",
            size === "sm" ? "h-7 px-2 text-xs" : "h-8 px-3 text-[13px]",
            value === o.value ? "bg-bg-elevated text-fg shadow-sm" : "text-fg-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 p-8 text-center">
      {icon && <div className="text-fg-subtle">{icon}</div>}
      <h3 className="text-base font-semibold">{title}</h3>
      {body && <p className="max-w-sm text-sm text-fg-muted">{body}</p>}
      {action}
    </div>
  );
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "fade-in pointer-events-auto flex max-w-md items-center gap-3 rounded-xl border bg-bg-elevated px-4 py-2.5 text-sm shadow-app",
            toast.kind === "error" ? "border-danger/40" : toast.kind === "success" ? "border-success/40" : "border-border",
          )}
          role={toast.kind === "error" ? "alert" : "status"}
        >
          {toast.kind === "error" ? (
            <AlertTriangle className="size-4 shrink-0 text-danger" />
          ) : toast.kind === "success" ? (
            <CheckCircle2 className="size-4 shrink-0 text-success" />
          ) : (
            <Info className="size-4 shrink-0 text-fg-muted" />
          )}
          <span className="min-w-0 flex-1">{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              className="shrink-0 font-medium text-accent hover:underline"
              onClick={() => {
                toast.action?.onClick();
                dismiss(toast.id);
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button type="button" className="shrink-0 text-fg-subtle hover:text-fg" onClick={() => dismiss(toast.id)} aria-label="Dismiss">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
