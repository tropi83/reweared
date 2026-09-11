import { ImagePlus, Menu, Upload } from "lucide-react";
import { useUiStore } from "@/app/stores/ui-store";
import { Button } from "@/components/ui/Button";
import { MAX_IMPORT_BYTES } from "@/domain/models";
import { useT } from "@/i18n";
import { cn } from "@/lib/cn";
import { importImageFile, pickImageFile, useDropZone } from "./useImageImport";

export function ImportDropzone({ compact = false, className }: { compact?: boolean; className?: string }) {
  const t = useT();
  const { active, handlers } = useDropZone((file) => void importImageFile(file));
  const maxMb = Math.round(MAX_IMPORT_BYTES / 1024 / 1024);

  return (
    <div
      {...handlers}
      className={cn(
        "relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-8 text-center transition-colors",
        active ? "border-accent bg-accent-soft" : "border-border hover:border-border-strong",
        compact ? "min-h-40" : "min-h-72",
        className,
      )}
    >
      <div className={cn("flex items-center justify-center rounded-2xl bg-accent-soft text-accent", compact ? "size-10" : "size-14")}>
        {active ? <Upload className="size-6" /> : <ImagePlus className="size-6" />}
      </div>
      <div>
        <div className="text-base font-semibold">{active ? t("import.dropHere") : t("import.dropTitle")}</div>
        <p className="mt-1 text-sm text-fg-muted">
          {t("import.dropBody")}{" "}
          <button
            type="button"
            className="font-medium text-accent underline-offset-2 hover:underline"
            onClick={async () => {
              const file = await pickImageFile();
              if (file) await importImageFile(file);
            }}
          >
            {t("import.browse")}
          </button>
        </p>
      </div>
      <p className="text-xs text-fg-subtle">{t("import.formats", { maxMb })}</p>
    </div>
  );
}

export function HomeView() {
  const t = useT();
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 items-center gap-2 border-b border-border px-4 md:hidden">
        <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)} aria-label={t("nav.projects")}>
          <Menu className="size-5" />
        </Button>
        <span className="font-semibold">{t("app.name")}</span>
      </header>
      <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
        <div className="w-full max-w-xl">
          <h1 className="text-2xl font-semibold tracking-tight">{t("projects.empty.title")}</h1>
          <p className="mt-1.5 mb-6 text-sm text-fg-muted">{t("projects.empty.body")}</p>
          <ImportDropzone />
          <p className="mt-6 text-center text-xs text-fg-subtle">{t("app.tagline")}</p>
        </div>
      </div>
    </div>
  );
}
