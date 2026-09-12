import { useState } from "react";
import { UserRound } from "lucide-react";
import { useSettingsStore } from "@/app/stores/settings-store";
import { Button } from "@/components/ui/Button";
import { normalizeMannequin } from "@/domain/services/mannequin";
import { useT } from "@/i18n";
import { MannequinDialog, MannequinSummary } from "../mannequin/MannequinDialog";
import { Section } from "./SettingsView";

/** Settings → Mannequin: summary, edit, delete. */
export function MannequinSection() {
  const t = useT();
  const stored = useSettingsStore((s) => s.settings.mannequin);
  const update = useSettingsStore((s) => s.update);
  const [open, setOpen] = useState(false);
  const mannequin = normalizeMannequin(stored);
  return (
    <Section id="mannequin" title={t("settings.section.mannequin")}>
      <div className="space-y-3 rounded-xl border border-border bg-bg-elevated p-4 text-sm">
        <p className="text-fg-muted">{t("mannequin.body")}</p>
        {mannequin ? <MannequinSummary mannequin={mannequin} /> : <p className="text-xs text-fg-subtle">{t("mannequin.none")}</p>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" leftIcon={<UserRound className="size-3.5" />} onClick={() => setOpen(true)}>
            {t(mannequin ? "mannequin.edit" : "mannequin.create")}
          </Button>
          {mannequin && (
            <Button size="sm" variant="ghost" onClick={() => void update({ mannequin: undefined })}>
              {t("mannequin.delete")}
            </Button>
          )}
        </div>
      </div>
      <MannequinDialog open={open} onClose={() => setOpen(false)} />
    </Section>
  );
}
