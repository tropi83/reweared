import type { ReactNode } from "react";
import { Label } from "@/components/ui/Input";

/** One titled settings block, addressable by `#settings-<id>`. */
export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={`settings-${id}`} className="scroll-mt-4 space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

/** Label + help on the left, control on the right. */
export function Field({ label, help, htmlFor, children }: { label: string; help?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[1fr_220px] sm:items-start sm:gap-4">
      <div>
        <Label htmlFor={htmlFor} className="text-sm text-fg">
          {label}
        </Label>
        {help && <p className="mt-0.5 text-xs text-fg-muted">{help}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}
