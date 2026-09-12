import { useState } from "react";
import { useSettingsStore } from "@/app/stores/settings-store";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Label } from "@/components/ui/Input";
import { Segmented } from "@/components/ui/Misc";
import { DEFAULT_MANNEQUIN, MANNEQUIN_BUILDS, MANNEQUIN_POSES, SKIN_TONE_SWATCH, SKIN_TONES, type Mannequin } from "@/domain/models";
import { normalizeMannequin } from "@/domain/services/mannequin";
import { useT, type MessageKey } from "@/i18n";
import { cn } from "@/lib/cn";

/** Edits the seller's single mannequin (settings.mannequin). */
export function MannequinDialog({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved?: (m: Mannequin) => void }) {
  const t = useT();
  const stored = useSettingsStore((s) => s.settings.mannequin);
  const update = useSettingsStore((s) => s.update);
  const initial = () => normalizeMannequin(stored) ?? DEFAULT_MANNEQUIN;
  const [draft, setDraft] = useState<Mannequin>(initial);
  // Re-sync each time the dialog opens (adjust state during render; no setState in effects).
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDraft(initial());
  }

  const save = () => {
    void update({ mannequin: draft });
    onSaved?.(draft);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("mannequin.title")}
      description={t("mannequin.body")}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={save}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>{t("mannequin.build")}</Label>
          <Segmented
            ariaLabel={t("mannequin.build")}
            value={draft.build}
            onChange={(build) => setDraft({ ...draft, build })}
            options={MANNEQUIN_BUILDS.map((b) => ({ value: b, label: b, title: t(`mannequin.build.${b}` as MessageKey) }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label>{t("mannequin.pose")}</Label>
          <Segmented
            ariaLabel={t("mannequin.pose")}
            value={draft.pose}
            onChange={(pose) => setDraft({ ...draft, pose })}
            options={MANNEQUIN_POSES.map((p) => ({ value: p, label: t(`mannequin.pose.${p}` as MessageKey) }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label>{t("mannequin.skin")}</Label>
          <div role="radiogroup" aria-label={t("mannequin.skin")} className="flex flex-wrap gap-2">
            {SKIN_TONES.map((tone) => (
              <button
                key={tone}
                type="button"
                role="radio"
                aria-checked={draft.skinTone === tone}
                aria-label={t(`mannequin.skin.${tone}` as MessageKey)}
                title={t(`mannequin.skin.${tone}` as MessageKey)}
                onClick={() => setDraft({ ...draft, skinTone: tone })}
                className={cn(
                  "size-9 rounded-full border-2 transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  draft.skinTone === tone ? "border-accent ring-2 ring-accent/40" : "border-border",
                )}
                style={{ backgroundColor: SKIN_TONE_SWATCH[tone] }}
              />
            ))}
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/** "M · Standing · ●" — compact summary for the listing card and the settings. */
export function MannequinSummary({ mannequin }: { mannequin: Mannequin }) {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
      <span>{mannequin.build}</span>
      <span aria-hidden>·</span>
      <span>{t(`mannequin.pose.${mannequin.pose}` as MessageKey)}</span>
      <span aria-hidden>·</span>
      <span
        role="img"
        aria-label={t(`mannequin.skin.${mannequin.skinTone}` as MessageKey)}
        className="inline-block size-3 rounded-full border border-border"
        style={{ backgroundColor: SKIN_TONE_SWATCH[mannequin.skinTone] }}
      />
    </span>
  );
}
