import { useEffect } from "react";
import { Menu } from "lucide-react";
import { useUiStore } from "@/app/stores/ui-store";
import { navigate } from "@/app/router";
import { Button } from "@/components/ui/Button";
import { useT, type MessageKey } from "@/i18n";
import { cn } from "@/lib/cn";
import { AboutSection } from "./AboutSection";
import { AppearanceSection } from "./AppearanceSection";
import { DiagnosticsSection } from "./DiagnosticsSection";
import { GenerationSection } from "./GenerationSection";
import { MannequinSection } from "./MannequinSection";
import { ModelsSection } from "./ModelsSection";
import { PrivacySection } from "./PrivacySection";
import { ProvidersSection } from "./ProvidersSection";
import { PublishSection } from "./PublishSection";
import { StorageSection } from "./StorageSection";
import { UsageSection } from "./UsageSection";

const SECTIONS: Array<{ id: string; key: MessageKey }> = [
  { id: "providers", key: "settings.section.providers" },
  { id: "models", key: "settings.section.models" },
  { id: "usage", key: "usage.title" },
  { id: "generation", key: "settings.section.generation" },
  { id: "appearance", key: "settings.section.appearance" },
  { id: "storage", key: "settings.section.storage" },
  { id: "privacy", key: "settings.section.privacy" },
  { id: "publish", key: "settings.section.publish" },
  { id: "mannequin", key: "settings.section.mannequin" },
  { id: "diagnostics", key: "settings.section.diagnostics" },
  { id: "about", key: "settings.section.about" },
];

export function SettingsView({ section }: { section?: string }) {
  const t = useT();
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);

  useEffect(() => {
    if (section) document.getElementById(`settings-${section}`)?.scrollIntoView({ block: "start" });
  }, [section]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 md:px-5">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setSidebarOpen(true)} aria-label={t("nav.listings")}>
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
            <ModelsSection />
            <UsageSection />
            <GenerationSection />
            <AppearanceSection />
            <StorageSection />
            <PrivacySection />
            <PublishSection />
            <MannequinSection />
            <DiagnosticsSection />
            <AboutSection />
          </div>
        </div>
      </div>
    </div>
  );
}
