import { useSettingsStore } from "@/app/stores/settings-store";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { ALL_ASPECT_RATIOS, type AspectRatio } from "@/domain/models";
import { useT } from "@/i18n";
import { Field, Section } from "./SettingsPrimitives";

export function GenerationSection() {
  const t = useT();
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  return (
    <Section id="generation" title={t("settings.section.generation")}>
      <div className="space-y-4 rounded-xl border border-border bg-bg-elevated p-4">
        <Field label={t("settings.concurrency")} help={t("settings.concurrencyHelp")} htmlFor="concurrency">
          <Input
            id="concurrency"
            type="number"
            min={1}
            max={8}
            value={settings.maxConcurrentJobs}
            onChange={(e) => void update({ maxConcurrentJobs: Number(e.target.value) })}
          />
        </Field>
        <Field label={t("settings.maxAttempts")} help={t("settings.maxAttemptsHelp")} htmlFor="attempts">
          <Input
            id="attempts"
            type="number"
            min={1}
            max={6}
            value={settings.maxAttempts}
            onChange={(e) => void update({ maxAttempts: Number(e.target.value) })}
          />
        </Field>
        <Field label={t("settings.timeout")} htmlFor="timeout">
          <Input
            id="timeout"
            type="number"
            min={15}
            max={600}
            value={Math.round(settings.jobTimeoutMs / 1000)}
            onChange={(e) => void update({ jobTimeoutMs: Number(e.target.value) * 1000 })}
          />
        </Field>
        <Field label={t("settings.prepareMax")} help={t("settings.prepareMaxHelp")} htmlFor="prepare">
          <Input
            id="prepare"
            type="number"
            min={512}
            max={8192}
            step={256}
            value={settings.prepareMaxDimension}
            onChange={(e) => void update({ prepareMaxDimension: Number(e.target.value) })}
          />
        </Field>
        <Field label={t("settings.defaultVariations")} htmlFor="defvar">
          <Select
            id="defvar"
            value={String(settings.defaultVariationCount)}
            options={[1, 2, 4, 6, 8].map((n) => ({ value: String(n), label: n }))}
            onChange={(v) => void update({ defaultVariationCount: Number(v) })}
          />
        </Field>
        <Field label={t("composer.aspectRatio")} htmlFor="defratio">
          <Select<AspectRatio>
            id="defratio"
            value={settings.defaultAspectRatio}
            options={ALL_ASPECT_RATIOS.map((r) => ({ value: r, label: r === "original" ? t("composer.aspectOriginal") : r }))}
            onChange={(defaultAspectRatio) => void update({ defaultAspectRatio })}
          />
        </Field>
      </div>
    </Section>
  );
}
