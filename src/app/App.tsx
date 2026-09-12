import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/Misc";
import { useT } from "@/i18n";
import { RecipesView } from "@/features/recipes/RecipesView";
import { SettingsView } from "@/features/settings/SettingsView";
import { Sidebar } from "@/features/projects/Sidebar";
import { HomeView } from "@/features/workspace/HomeView";
import { WorkspaceView } from "@/features/workspace/WorkspaceView";
import { useGlobalImport } from "@/features/workspace/useImageImport";
import { bootstrap } from "./bootstrap";
import { useRoute } from "./router";
import { useUiStore } from "./stores/ui-store";
import { cn } from "@/lib/cn";

export function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    bootstrap()
      .then(() => setReady(true))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div>
          <h1 className="text-lg font-semibold">Something went wrong while starting</h1>
          <p className="mt-2 text-sm text-fg-muted">{error}</p>
        </div>
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="size-6 animate-spin rounded-full border-2 border-fg-subtle border-t-transparent" aria-label="Loading" />
      </div>
    );
  }
  return <Shell />;
}

function Shell() {
  const route = useRoute();
  const t = useT();
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  useGlobalImport();

  useEffect(() => {
    setSidebarOpen(false);
  }, [route, setSidebarOpen]);

  // Safe areas: with viewport-fit=cover the iOS WebView runs under the status bar/notch/home indicator,
  // so the shell reserves them. Android reserves them natively (MainActivity) and desktop reports 0.
  return (
    <div className="flex h-full overflow-hidden bg-bg pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-bg-elevated focus:px-3 focus:py-2"
      >
        {t("nav.workspace")}
      </a>
      {/* Mobile scrim */}
      <div
        className={cn("fixed inset-0 z-30 bg-black/50 transition-opacity md:hidden", sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0")}
        onClick={() => setSidebarOpen(false)}
        aria-hidden
      />
      <aside
        className={cn(
          // The mobile drawer is fixed to the viewport, outside the shell's padding: it reserves the safe areas itself.
          "fixed inset-y-0 left-0 z-40 w-72 shrink-0 border-r border-border bg-bg-sunken pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] transition-transform md:static md:translate-x-0 md:p-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <Sidebar />
      </aside>
      <main id="main" className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        {route.name === "settings" && <SettingsView section={route.section} />}
        {route.name === "recipes" && <RecipesView />}
        {route.name === "project" && <WorkspaceView projectId={route.id} />}
        {route.name === "home" && <HomeView />}
      </main>
      <Toaster />
    </div>
  );
}
