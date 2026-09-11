import { useEffect, useState } from "react";
import { ExternalLink, Gauge } from "lucide-react";
import { navigate } from "@/app/router";
import { getServices } from "@/app/services";
import type { UsageSnapshot } from "@/domain/services/usage-tracker";
import { GOOGLE_RATE_LIMIT_DASHBOARD } from "@/infrastructure/providers/gemini/GeminiErrors";
import { openExternal } from "@/lib/open-external";
import { useT } from "@/i18n";
import { cn } from "@/lib/cn";

/** Re-renders on tracker events and every few seconds so the rolling minute window decays. */
export function useUsage(providerId: string, modelId: string | null): UsageSnapshot | null {
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null);
  useEffect(() => {
    if (!modelId) return;
    const { usage } = getServices();
    const refresh = () => setSnapshot(usage.snapshot(providerId, modelId));
    refresh();
    const unsubscribe = usage.subscribe(refresh);
    const timer = setInterval(refresh, 5000);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [providerId, modelId]);
  return snapshot;
}

function tone(ratio: number | undefined): string {
  if (ratio === undefined) return "bg-accent";
  if (ratio >= 1) return "bg-danger";
  if (ratio >= 0.8) return "bg-warning";
  return "bg-accent";
}

function Bar({ label, used, limit, ratio }: { label: string; used: number; limit?: number; ratio?: number }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-fg-muted">{label}</span>
        <span className="font-mono tabular-nums">
          {used}
          {limit !== undefined ? ` / ${limit}` : ""}
        </span>
      </div>
      <div
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-bg-sunken"
        role="progressbar"
        aria-valuenow={used}
        aria-valuemin={0}
        {...(limit !== undefined ? { "aria-valuemax": limit } : {})}
        aria-label={label}
      >
        <div
          className={cn("h-full rounded-full transition-[width]", tone(ratio))}
          style={{ width: `${Math.round((ratio ?? (used > 0 ? 0.08 : 0)) * 100)}%` }}
        />
      </div>
    </div>
  );
}

/** Compact local usage gauge for the selected model, shown under the Generate button. */
export function UsageMeter({ providerId, modelId }: { providerId: string; modelId: string | null }) {
  const t = useT();
  const snapshot = useUsage(providerId, modelId);
  if (!snapshot || !modelId) return null;
  const { minute, day } = snapshot;
  const hasLimits = minute.limit !== undefined || day.limit !== undefined;
  const resetTime = new Date(day.resetsAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="rounded-lg border border-border bg-bg-elevated/60 p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-fg-muted">
        <Gauge className="size-3.5" />
        {t("usage.title")}
        <button type="button" className="ml-auto text-accent hover:underline" onClick={() => navigate({ name: "settings", section: "usage" })}>
          {t("usage.details")}
        </button>
        {providerId === "gemini" && (
          <button
            type="button"
            className="inline-flex items-center gap-0.5 text-accent hover:underline"
            title={t("usage.openGoogleDashboard")}
            onClick={() => void openExternal(GOOGLE_RATE_LIMIT_DASHBOARD)}
          >
            {t("usage.googleDashboard")} <ExternalLink className="size-3" />
          </button>
        )}
      </div>
      <div className="flex gap-3">
        <Bar label={t("usage.minute")} used={minute.used} limit={minute.limit} ratio={minute.ratio} />
        <Bar label={t("usage.today")} used={day.used} limit={day.limit} ratio={day.ratio} />
      </div>
      <p className="mt-1.5 text-[10px] leading-snug text-fg-subtle">
        {hasLimits
          ? t(snapshot.limitSource === "manual" ? "usage.limitsManual" : "usage.limitsLearned", { time: resetTime })
          : t("usage.limitsUnknown", { time: resetTime })}
        {snapshot.throttledToday > 0 ? ` · ${t("usage.throttled", { count: snapshot.throttledToday })}` : ""}
      </p>
    </div>
  );
}
