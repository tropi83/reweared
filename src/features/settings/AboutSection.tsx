import { useT } from "@/i18n";
import { Section } from "./SettingsPrimitives";

export function AboutSection() {
  const t = useT();
  return (
    <Section id="about" title={t("settings.section.about")}>
      <div className="rounded-xl border border-border bg-bg-elevated p-4 text-sm">
        <p className="font-medium">{t("app.name")}</p>
        <p className="text-fg-muted">{t("app.tagline")}</p>
        <p className="mt-2 text-fg-muted">{t("about.body")}</p>
        <p className="mt-2 text-xs text-fg-subtle">{t("about.local")}</p>
      </div>
    </Section>
  );
}
