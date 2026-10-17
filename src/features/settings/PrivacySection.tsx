import { useT } from "@/i18n";
import { Section } from "./SettingsPrimitives";

export function PrivacySection() {
  const t = useT();
  return (
    <Section id="privacy" title={t("settings.section.privacy")}>
      <div className="space-y-3 rounded-xl border border-border bg-bg-elevated p-4 text-sm">
        <p className="text-fg-muted">{t("privacy.body")}</p>
        <div>
          <h3 className="font-medium">{t("privacy.ads")}</h3>
          <p className="text-fg-muted">{t("privacy.adsBody")}</p>
        </div>
      </div>
    </Section>
  );
}
