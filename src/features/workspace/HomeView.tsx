import { useMemo } from "react";
import { Camera, ImagePlus, Images, Menu, Upload } from "lucide-react";
import { useImageUrl } from "@/app/image-urls";
import { navigate } from "@/app/router";
import { useProjectsStore } from "@/app/stores/projects-store";
import { useUiStore } from "@/app/stores/ui-store";
import { Button } from "@/components/ui/Button";
import { MAX_IMPORT_BYTES, type ProjectSummary } from "@/domain/models";
import { useT } from "@/i18n";
import { getPlatform } from "@/infrastructure/platform/capabilities";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/format";
import { importImageFile, pickImageFile, useDropZone, type ImportSource } from "./useImageImport";

async function pickAndImport(source: ImportSource) {
  const file = await pickImageFile(source);
  if (file) await importImageFile(file);
}

/**
 * Entry point for a new source image. Desktop/web: drop zone + paste + file browser.
 * Mobile: two explicit actions — photo library or camera — since drag-and-drop and paste do not exist there.
 */
export function ImportDropzone({ compact = false, className }: { compact?: boolean; className?: string }) {
  const t = useT();
  const { active, handlers } = useDropZone((file) => void importImageFile(file));
  const maxMb = Math.round(MAX_IMPORT_BYTES / 1024 / 1024);
  const mobile = getPlatform().isMobile;

  if (mobile) {
    return (
      <div className={cn("flex flex-col items-center gap-3 rounded-2xl border border-border bg-bg-elevated/60 p-5 text-center", className)}>
        {!compact && (
          <div className="flex size-14 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <ImagePlus className="size-6" />
          </div>
        )}
        <div className="grid w-full grid-cols-2 gap-2">
          <Button variant="primary" size="lg" leftIcon={<Images className="size-4" />} onClick={() => void pickAndImport("gallery")}>
            {t("import.gallery")}
          </Button>
          <Button variant="secondary" size="lg" leftIcon={<Camera className="size-4" />} onClick={() => void pickAndImport("camera")}>
            {t("import.camera")}
          </Button>
        </div>
        <p className="text-xs text-fg-subtle">{t("import.formats", { maxMb })}</p>
      </div>
    );
  }

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
          <button type="button" className="font-medium text-accent underline-offset-2 hover:underline" onClick={() => void pickAndImport("files")}>
            {t("import.browse")}
          </button>
        </p>
      </div>
      <p className="text-xs text-fg-subtle">{t("import.formats", { maxMb })}</p>
    </div>
  );
}

/** "Projects" screen: every project on this device as a card, plus the import entry point. */
export function HomeView() {
  const t = useT();
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const summaries = useProjectsStore((s) => s.summaries);
  const loadingList = useProjectsStore((s) => s.loadingList);
  const empty = !loadingList && summaries.length === 0;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 items-center gap-2 border-b border-border px-4 md:hidden">
        <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)} aria-label={t("nav.projects")}>
          <Menu className="size-5" />
        </Button>
        <span className="font-semibold">{t("app.name")}</span>
      </header>

      {empty ? (
        <div className="flex flex-1 items-center justify-center overflow-y-auto p-6">
          <div className="w-full max-w-xl">
            <h1 className="text-2xl font-semibold tracking-tight">{t("projects.empty.title")}</h1>
            <p className="mt-1.5 mb-6 text-sm text-fg-muted">{t("projects.empty.body")}</p>
            <ImportDropzone />
            <p className="mt-6 text-center text-xs text-fg-subtle">{t("app.tagline")}</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 md:p-6">
          <div className="mx-auto w-full max-w-5xl">
            <div className="mb-4 flex items-end justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">{t("nav.projects")}</h1>
                <p className="mt-1 text-sm text-fg-muted">{t("projects.count", { count: summaries.length })}</p>
              </div>
            </div>
            <ImportDropzone compact className="mb-6" />
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label={t("nav.projects")}>
              {summaries.map((p) => (
                <ProjectCard key={p.id} project={p} />
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function ProjectCard({ project }: { project: ProjectSummary }) {
  const t = useT();
  const url = useImageUrl(project.id, "thumbnail", project.coverImageId);
  const updated = useMemo(() => formatRelative(project.updatedAt), [project.updatedAt]);
  return (
    <li>
      <button
        type="button"
        onClick={() => navigate({ name: "project", id: project.id })}
        className="group flex w-full flex-col overflow-hidden rounded-xl border border-border bg-bg-elevated text-left shadow-sm transition-[box-shadow,border-color] hover:border-border-strong hover:shadow-app focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
      >
        <div className="checkerboard aspect-square w-full overflow-hidden bg-bg-sunken">
          {url ? (
            <img src={url} alt="" className="size-full object-cover transition-transform group-hover:scale-[1.02]" loading="lazy" decoding="async" />
          ) : (
            <div className="shimmer size-full" />
          )}
        </div>
        <div className="min-w-0 p-2.5">
          <div className="truncate text-sm font-medium">{project.name}</div>
          <div className="mt-0.5 truncate text-[11px] text-fg-subtle">
            {t("projects.imageCount", { count: project.imageCount })} · {t("projects.updated", { when: updated })}
          </div>
        </div>
      </button>
    </li>
  );
}
