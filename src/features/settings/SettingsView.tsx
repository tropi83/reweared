import { useEffect, useState, type ReactNode } from "react";
import { Copy, Menu, Trash2 } from "lucide-react";
import { useProjectsStore } from "@/app/stores/projects-store";
import { useSettingsStore } from "@/app/stores/settings-store";
import { toast } from "@/app/stores/toast-store";
import { useUiStore } from "@/app/stores/ui-store";
import { getServices } from "@/app/services";
import { navigate } from "@/app/router";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Input, Label, Select } from "@/components/ui/Input";
import { Segmented } from "@/components/ui/Misc";
import { ALL_ASPECT_RATIOS, type AspectRatio, type Locale, type ThemePreference } from "@/domain/models";
import { getPlatform } from "@/infrastructure/platform/capabilities";
import type { StorageUsage } from "@/infrastructure/storage";
import { useT, type MessageKey } from "@/i18n";
import { getRecentLogs } from "@/lib/logger";
import { cn } from "@/lib/cn";
import { ProvidersSection } from "./ProvidersSection";
import { UsageSection } from "./UsageSection";

const SECTIONS: Array<{ id: string; key: MessageKey }> = [
  { id: "providers", key: "settings.section.providers" },
  { id: "usage", key: "usage.title" },
  { id: "generation", key: "settings.section.generation" },
  { id: "appearance", key: "settings.section.appearance" },
  { id: "storage", key: "settings.section.storage" },
  { id: "privacy", key: "settings.section.privacy" },
  { id: "diagnostics", key: "settings.section.diagnostics" },
  { id: "about", key: "settings.section.about" },
];

export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={`settings-${id}`} className="scroll-mt-4 space-y-3">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

export function SettingsView({ section }: { section?: string }) {
  const t = useT();
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);

  useEffect(() => {
    if (section) document.getElementById(`settings-${section}`)?.scrollIntoView({ block: "start" });
  }, [section]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 md:px-5">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setSidebarOpen(true)} aria-label={t("nav.projects")}>
          <Menu className="size-5" />
        </Button>
        <h1 className="text-base font-semibold">{t("settings.title")}</h1>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav className="hidden w-48 shrink-0 border-r border-border p-3 lg:block" aria-label={t("settings.title")}>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => navigate({ name: "settings", section: s.id })}
              className={cn(
                "block w-full rounded-md px-2.5 py-1.5 text-left text-sm text-fg-muted hover:bg-bg-elevated hover:text-fg",
                section === s.id && "bg-bg-elevated text-fg",
              )}
            >
              {t(s.key)}
            </button>
          ))}
        </nav>
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-10 p-4 pb-24 md:p-6">
            <ProvidersSection />
            <UsageSection />
            <GenerationSection />
            <AppearanceSection />
            <StorageSection />
            <PrivacySection />
            <DiagnosticsSection />
            <AboutSection />
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, help, htmlFor, children }: { label: string; help?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[1fr_220px] sm:items-start sm:gap-4">
      <div>
        <Label htmlFor={htmlFor} className="text-sm text-fg">
          {label}
        </Label>
        {help && <p className="mt-0.5 text-xs text-fg-muted">{help}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}

function GenerationSection() {
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
          <Select id="defvar" value={settings.defaultVariationCount} onChange={(e) => void update({ defaultVariationCount: Number(e.target.value) })}>
            {[1, 2, 4, 6, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("composer.aspectRatio")} htmlFor="defratio">
          <Select id="defratio" value={settings.defaultAspectRatio} onChange={(e) => void update({ defaultAspectRatio: e.target.value as AspectRatio })}>
            {ALL_ASPECT_RATIOS.map((r) => (
              <option key={r} value={r}>
                {r === "original" ? t("composer.aspectOriginal") : r}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Section>
  );
}

function AppearanceSection() {
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function StorageSection() {
  const t = useT();
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const summaries = useProjectsStore((s) => s.summaries);
  const platform = getPlatform();

  useEffect(() => {
    void getServices().storage.getUsage().then(setUsage);
  }, [summaries]);

  const cleanup = async () => {
    setBusy(true);
    try {
      let removed = 0;
      for (const p of summaries) removed += await getServices().storage.cleanupOrphans(p.id);
      toast.success(t("storage.cleanupDone", { count: removed }));
      setUsage(await getServices().storage.getUsage());
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async () => {
    setBusy(true);
    try {
      const { storage, auth, queue } = getServices();
      queue.cancelAll();
      await storage.clearAll();
      await auth.apiKey.revoke();
      await auth.oauth.revoke().catch(() => undefined);
      auth.setActiveKind("none");
      useProjectsStore.setState({ current: null, summaries: [] });
      navigate({ name: "home" });
      location.reload();
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  return (
    <Section id="storage" title={t("settings.section.storage")}>
      <div className="space-y-4 rounded-xl border border-border bg-bg-elevated p-4">
        <Field label={t("storage.location")}>
          <code className="block rounded-md bg-bg-sunken px-2 py-1 text-xs break-all">
            {platform.isTauri ? (usage?.location ?? "…") : t("storage.locationWeb")}
          </code>
        </Field>
        <Field label={t("settings.section.storage")}>
          <span className="text-sm">{usage ? t("storage.usage", { count: usage.projectCount, size: formatBytes(usage.imageBytes) }) : "…"}</span>
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void cleanup()} loading={busy}>
            {t("storage.cleanup")}
          </Button>
          <Button variant="danger" leftIcon={<Trash2 className="size-4" />} onClick={() => setConfirm(true)}>
            {t("storage.clearAll")}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={clearAll}
        title={t("storage.clearAll")}
        body={t("storage.clearAll.body")}
        confirmLabel={t("common.delete")}
        danger
        busy={busy}
      />
    </Section>
  );
}

function PrivacySection() {
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

function DiagnosticsSection() {
  const t = useT();
  const doc = useProjectsStore((s) => s.current);
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

function AboutSection() {
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
