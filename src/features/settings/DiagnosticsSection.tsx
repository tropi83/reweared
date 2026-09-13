import { Copy } from "lucide-react";
import { useListingsStore } from "@/app/stores/listings-store";
import { useSettingsStore } from "@/app/stores/settings-store";
import { toast } from "@/app/stores/toast-store";
import { getServices } from "@/app/services";
import { Button } from "@/components/ui/Button";
import { getPlatform } from "@/infrastructure/platform/capabilities";
import { useT } from "@/i18n";
import { getRecentLogs } from "@/lib/logger";
import { Section } from "./SettingsPrimitives";

export function DiagnosticsSection() {
  const t = useT();
  const doc = useListingsStore((s) => s.current);
  const settings = useSettingsStore((s) => s.settings);
  const platform = getPlatform();
  const { appVersion, queue } = getServices();
  const activeJobs = doc ? Object.values(doc.jobs).filter((j) => j.status === "queued" || j.status === "generating").length : 0;
  const logs = getRecentLogs();

  const report = () =>
    [
      `app: ${appVersion}`,
      `platform: ${platform.kind}`,
      `provider: ${settings.activeProviderId}`,
      `model: ${settings.lastModelByProvider[settings.activeProviderId] ?? "-"}`,
      `active jobs: ${queue.activeCount}`,
      "",
      ...logs.slice(-50).map((l) => `${l.ts} [${l.level}] [${l.scope}] ${l.message}`),
    ].join("\n");

  return (
    <Section id="diagnostics" title={t("settings.section.diagnostics")}>
      <div className="space-y-3 rounded-xl border border-border bg-bg-elevated p-4 text-sm">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
          <Diag label={t("diagnostics.version")} value={appVersion} />
          <Diag label={t("diagnostics.platform")} value={platform.kind} />
          <Diag label={t("diagnostics.provider")} value={settings.activeProviderId} />
          <Diag label={t("diagnostics.model")} value={settings.lastModelByProvider[settings.activeProviderId] ?? "—"} />
          <Diag label={t("diagnostics.jobs")} value={String(activeJobs)} />
        </dl>
        <div>
          <h3 className="mb-1 text-xs font-medium tracking-wider text-fg-subtle uppercase">{t("diagnostics.logs")}</h3>
          <pre className="max-h-48 overflow-auto rounded-md bg-bg-sunken p-2 text-[11px] leading-relaxed text-fg-muted">
            {logs
              .slice(-30)
              .map((l) => `${l.ts.slice(11, 19)} ${l.level.padEnd(5)} ${l.scope}: ${l.message}`)
              .join("\n") || "—"}
          </pre>
        </div>
        <div className="flex items-center gap-3">
          <Button
            size="sm"
            leftIcon={<Copy className="size-3.5" />}
            onClick={() => {
              void navigator.clipboard?.writeText(report());
              toast.info(t("common.copied"));
            }}
          >
            {t("diagnostics.copy")}
          </Button>
          <span className="text-xs text-fg-subtle">{t("diagnostics.noSecrets")}</span>
        </div>
      </div>
    </Section>
  );
}

function Diag({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] tracking-wider text-fg-subtle uppercase">{label}</dt>
      <dd className="truncate font-mono text-xs">{value}</dd>
    </div>
  );
}
