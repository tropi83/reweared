import { useEffect, useState } from "react";
import { ExternalLink, RotateCcw } from "lucide-react";
import { getServices } from "@/app/services";
import { useComposerStore } from "@/app/stores/composer-store";
import { useSettingsStore } from "@/app/stores/settings-store";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Misc";
import { resolveCopyModel } from "@/domain/services/listing-copy";
import type { UsageSnapshot } from "@/domain/services/usage-tracker";
import { GOOGLE_RATE_LIMIT_DASHBOARD } from "@/infrastructure/providers/gemini/GeminiErrors";
import { useT } from "@/i18n";
import { openExternal } from "@/lib/open-external";
import { CF_WORKERS_AI_DASHBOARD } from "./CloudflareCard";
import { Section } from "./SettingsPrimitives";
import { UsageGauge } from "./UsageGauge";

/** Providers that always get a block, in this order; any other provider with recorded usage follows. */
const PINNED_PROVIDERS = ["gemini", "cloudflare"] as const;
const DASHBOARDS: Record<string, { url: string; label: "usage.openGoogleDashboard" | "usage.openCloudflareDashboard" }> = {
  gemini: { url: GOOGLE_RATE_LIMIT_DASHBOARD, label: "usage.openGoogleDashboard" },
  cloudflare: { url: CF_WORKERS_AI_DASHBOARD, label: "usage.openCloudflareDashboard" },
};

interface Row {
  provider: string;
  model: string;
  snapshot: UsageSnapshot;
}

function useRows(): Row[] {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    const { usage } = getServices();
    const refresh = () => setRows(usage.knownModels().map((m) => ({ ...m, snapshot: usage.snapshot(m.provider, m.model) })));
    refresh();
    const unsubscribe = usage.subscribe(refresh);
    const timer = setInterval(refresh, 5000);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, []);
  return rows;
}

function LimitInput({ provider, model, field, value }: { provider: string; model: string; field: "perMinute" | "perDay"; value: number | undefined }) {
  const t = useT();
  const [draft, setDraft] = useState(value === undefined ? "" : String(value));
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value === undefined ? "" : String(value));
  }
  const commit = () => {
    const { usage } = getServices();
    const current = usage.getLimit(provider, model);
    const n = draft.trim() === "" ? undefined : Number(draft);
    if (n !== undefined && (!Number.isFinite(n) || n < 0)) return;
    usage.setManualLimit(provider, model, {
      ...(current?.perMinute !== undefined ? { perMinute: current.perMinute } : {}),
      ...(current?.perDay !== undefined ? { perDay: current.perDay } : {}),
      ...(n !== undefined ? { [field]: n } : { [field]: undefined }),
    });
  };
  return (
    <Input
      type="number"
      min={0}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      placeholder="—"
      className="h-8 w-24"
      aria-label={`${model} ${field === "perMinute" ? t("usage.minute") : t("usage.today")}`}
    />
  );
}

function providerName(id: string): string {
  const { providers, copyProviders } = getServices();
  return providers.get(id)?.info.displayName ?? copyProviders.get(id)?.displayName ?? id;
}

/** The model whose gauge is shown for a provider: the one it is currently used with (photos or text). */
function useSelectedModel(providerId: string): string | null {
  const composer = useComposerStore();
  const settings = useSettingsStore((s) => s.settings);
  if (composer.providerId === providerId && composer.modelId) return composer.modelId;
  const copy = getServices().copyProviders.get(providerId);
  if (copy) return resolveCopyModel(copy, settings.copyModelByProvider[providerId]).id;
  return settings.lastModelByProvider[providerId] ?? null;
}

function ProviderUsage({ providerId, rows }: { providerId: string; rows: Row[] }) {
  const t = useT();
  const modelId = useSelectedModel(providerId);
  const dashboard = DASHBOARDS[providerId];
  const name = providerName(providerId);
  return (
    <fieldset className="space-y-3 rounded-xl border border-border bg-bg-elevated p-4 text-sm">
      <legend className="px-1 text-sm font-medium">{name}</legend>
      {dashboard && (
        <Button size="sm" variant="secondary" rightIcon={<ExternalLink className="size-3.5" />} onClick={() => void openExternal(dashboard.url)}>
          {t(dashboard.label)}
        </Button>
      )}
      <UsageGauge providerId={providerId} modelId={modelId} />
      {rows.length === 0 ? (
        <p className="text-fg-subtle">{t("usage.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] tracking-wider text-fg-subtle uppercase">
              <tr>
                <th className="py-1.5 pr-3 font-medium">{t("composer.model")}</th>
                <th className="py-1.5 pr-3 font-medium">{t("usage.minute")}</th>
                <th className="py-1.5 pr-3 font-medium">{t("usage.today")}</th>
                <th className="py-1.5 pr-3 font-medium">{t("usage.limitMinute")}</th>
                <th className="py-1.5 pr-3 font-medium">{t("usage.limitDay")}</th>
                <th className="py-1.5 font-medium">{t("usage.source")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const limit = getServices().usage.getLimit(r.provider, r.model);
                return (
                  <tr key={r.model} className="border-t border-border">
                    <td className="py-2 pr-3 font-mono text-xs">{r.model}</td>
                    <td className="py-2 pr-3 tabular-nums">{r.snapshot.minute.used}</td>
                    <td className="py-2 pr-3 tabular-nums">
                      {r.snapshot.day.used}
                      {r.snapshot.throttledToday > 0 && (
                        <span className="ml-1 text-warning">({t("usage.throttled", { count: r.snapshot.throttledToday })})</span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      <LimitInput provider={r.provider} model={r.model} field="perMinute" value={limit?.perMinute} />
                    </td>
                    <td className="py-2 pr-3">
                      <LimitInput provider={r.provider} model={r.model} field="perDay" value={limit?.perDay} />
                    </td>
                    <td className="py-2">
                      {limit ? (
                        <Badge tone={limit.source === "manual" ? "accent" : "neutral"}>
                          {t(limit.source === "manual" ? "usage.sourceManual" : "usage.sourceLearned")}
                        </Badge>
                      ) : (
                        <span className="text-fg-subtle">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </fieldset>
  );
}

export function UsageSection() {
  const t = useT();
  const rows = useRows();
  const [confirm, setConfirm] = useState(false);
  const providerIds = [...PINNED_PROVIDERS, ...rows.map((r) => r.provider).filter((id) => !(PINNED_PROVIDERS as readonly string[]).includes(id))];

  return (
    <Section id="usage" title={t("usage.title")}>
      <div className="space-y-4">
        <p className="text-sm text-fg-muted">{t("usage.body")}</p>
        {[...new Set(providerIds)].map((id) => (
          <ProviderUsage key={id} providerId={id} rows={rows.filter((r) => r.provider === id)} />
        ))}
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-fg-subtle">{t("usage.reset.help")}</p>
          <Button size="sm" variant="ghost" leftIcon={<RotateCcw className="size-3.5" />} onClick={() => setConfirm(true)}>
            {t("usage.reset")}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t("usage.reset")}
        body={t("usage.reset.body")}
        danger
        onConfirm={() => {
          getServices().usage.reset();
          setConfirm(false);
        }}
      />
    </Section>
  );
}
