import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/i18n";
import { Button } from "./Button";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "full";
  className?: string;
}

const sizeClass = { sm: "w-[min(420px,92vw)]", md: "w-[min(560px,92vw)]", lg: "w-[min(760px,94vw)]", full: "w-[96vw] h-[94vh]" };

/** Accessible modal built on the native <dialog> element (focus trap + Esc for free). */
export function Dialog({ open, onClose, title, description, children, footer, size = "md", className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        "open:fade-in m-auto rounded-2xl border border-border bg-bg-elevated p-0 text-fg shadow-app backdrop:bg-black/50",
        sizeClass[size],
        className,
      )}
    >
      {open && (
        <div className="flex max-h-[90vh] flex-col">
          {(title || description) && (
            <header className="flex items-start gap-3 border-b border-border px-5 py-4">
              <div className="min-w-0 flex-1">
                {title && <h2 className="text-base leading-tight font-semibold">{title}</h2>}
                {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
              </div>
              <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t("common.close")}>
                <X className="size-4" />
              </Button>
            </header>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel,
  danger,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: ReactNode;
  body?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant={danger ? "danger" : "primary"} onClick={() => void onConfirm()} loading={busy} autoFocus>
            {confirmLabel ?? t("common.confirm")}
          </Button>
        </>
      }
    >
      {body && <p className="text-sm text-fg-muted">{body}</p>}
    </Dialog>
  );
}
