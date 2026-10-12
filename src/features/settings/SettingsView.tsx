import { useEffect, type ComponentType } from "react";
import { Menu } from "lucide-react";
import { useUiStore } from "@/app/stores/ui-store";
import { navigate } from "@/app/router";
import { Button } from "@/components/ui/Button";
import { useT, type MessageKey } from "@/i18n";
import { cn } from "@/lib/cn";
import { AccountSection } from "@/features/account/AccountSection";
import { CreditsSection } from "@/features/account/CreditsSection";
import { AboutSection } from "./AboutSection";
import { AppearanceSection } from "./AppearanceSection";
import { DiagnosticsSection } from "./DiagnosticsSection";
import { MannequinSection } from "./MannequinSection";
import { PrivacySection } from "./PrivacySection";
import { PublishSection } from "./PublishSection";

export const SECTIONS: Array<{ id: string; key: MessageKey; Component: ComponentType }> = [
  { id: "account", key: "account.section", Component: AccountSection },
  { id: "credits", key: "credits.title", Component: CreditsSection },
  { id: "appearance", key: "settings.section.appearance", Component: AppearanceSection },
  { id: "privacy", key: "settings.section.privacy", Component: PrivacySection },
  { id: "publish", key: "settings.section.publish", Component: PublishSection },
  { id: "mannequin", key: "settings.section.mannequin", Component: MannequinSection },
  { id: "diagnostics", key: "settings.section.diagnostics", Component: DiagnosticsSection },
  { id: "about", key: "settings.section.about", Component: AboutSection },
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
            {SECTIONS.map(({ id, Component }) => (
              <Component key={id} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
