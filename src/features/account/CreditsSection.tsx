import { useCredits, usePlatform } from "@/app/query/credits";
import { useLocale, useT, type MessageKey } from "@/i18n";
import { Section } from "@/features/settings/SettingsPrimitives";

const REASONS: Record<string, MessageKey> = {
  grant: "credits.reason.grant",
  reserve: "credits.reason.reserve",
  refund: "credits.reason.refund",
  adjust: "credits.reason.adjust",
};

/** Settings → Credits (API mode): balance, the monthly free credits, what a photo and a text cost, latest movements. */
export function CreditsSection() {
  const t = useT();
  const locale = useLocale();
  const { credits, error } = useCredits();
  const platform = usePlatform();
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  return (
    <Section id="credits" title={t("credits.title")}>
      <div className="space-y-3 rounded-xl border border-border bg-bg-elevated p-4 text-sm">
        {credits ? (
          <p className="text-lg font-semibold">{t("credits.balance", { count: credits.balance })}</p>
        ) : (
          <p className="text-fg-muted">{error ? t("account.error.generic") : "…"}</p>
        )}
        {platform && (
          <p className="text-fg-muted">
            {t("credits.explain", { free: platform.freeMonthlyCredits, image: platform.runCost.image, copy: platform.runCost.copy })}
          </p>
        )}
        {credits && credits.ledger.length > 0 && (
          <ul className="divide-y divide-border border-t border-border">
            {credits.ledger.slice(0, 10).map((entry, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                <span className="text-fg-muted">{date.format(new Date(entry.createdAt))}</span>
                <span className="flex-1">{t(REASONS[entry.reason] ?? "credits.reason.adjust")}</span>
                <span className={entry.delta < 0 ? "text-fg" : "text-success"}>{entry.delta > 0 ? `+${entry.delta}` : entry.delta}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
