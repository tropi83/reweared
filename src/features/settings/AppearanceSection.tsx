import { useSettingsStore } from "@/app/stores/settings-store";
import { Segmented } from "@/components/ui/Misc";
import type { Locale, ThemePreference } from "@/domain/models";
import { useT } from "@/i18n";
import { Field, Section } from "./SettingsPrimitives";

export function AppearanceSection() {
  const t = useT();
  const settings = useSettingsStore((s) => s.settings);
  const update = useSettingsStore((s) => s.update);
  return (
    <Section id="appearance" title={t("settings.section.appearance")}>
      <div className="space-y-4 rounded-xl border border-border bg-bg-elevated p-4">
        <Field label={t("settings.theme")}>
          <Segmented<ThemePreference>
            ariaLabel={t("settings.theme")}
            value={settings.theme}
            onChange={(theme) => void update({ theme })}
            options={[
              { value: "system", label: t("settings.theme.system") },
              { value: "dark", label: t("settings.theme.dark") },
              { value: "light", label: t("settings.theme.light") },
            ]}
          />
        </Field>
        <Field label={t("settings.language")}>
          <Segmented<Locale>
            ariaLabel={t("settings.language")}
            value={settings.locale}
            onChange={(locale) => void update({ locale })}
            options={[
              { value: "en", label: "English" },
              { value: "fr", label: "Français" },
            ]}
          />
        </Field>
      </div>
    </Section>
  );
}
