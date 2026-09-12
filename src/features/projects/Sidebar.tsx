import { useState } from "react";
import { BookOpen, Images, MoreHorizontal, Plus, Settings, Sparkles } from "lucide-react";
import { useImageUrl } from "@/app/image-urls";
import { navigate, useRoute } from "@/app/router";
import { useProjectsStore } from "@/app/stores/projects-store";
import { toast } from "@/app/stores/toast-store";
import { useUiStore } from "@/app/stores/ui-store";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import type { ProjectSummary } from "@/domain/models";
import { getPlatform } from "@/infrastructure/platform/capabilities";
import { useT } from "@/i18n";
import { cn } from "@/lib/cn";
import { importImageFile, pickImageFile } from "../workspace/useImageImport";

export function Sidebar() {
  const t = useT();
  const route = useRoute();
  const summaries = useProjectsStore((s) => s.summaries);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <div className="flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <Sparkles className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm leading-tight font-semibold">{t("app.name")}</div>
          <div className="truncate text-[11px] text-fg-subtle">{t("about.local")}</div>
        </div>
      </div>

      <div className="px-3">
        <Button
          variant="primary"
          className="w-full"
          leftIcon={<Plus className="size-4" />}
          onClick={async () => {
            // Phones choose between the photo library and the camera on the home screen; desktop opens the file dialog.
            if (getPlatform().isMobile) {
              navigate({ name: "home" });
              useUiStore.getState().setSidebarOpen(false);
              return;
            }
            const file = await pickImageFile();
            if (file) await importImageFile(file);
          }}
        >
          {t("nav.newProject")}
        </Button>
      </div>

      <nav className="mt-3 px-3">
        <NavItem active={route.name === "home"} icon={<Images className="size-4" />} label={t("nav.projects")} onClick={() => navigate({ name: "home" })} />
        <NavItem
          active={route.name === "recipes"}
          icon={<BookOpen className="size-4" />}
          label={t("nav.recipes")}
          onClick={() => navigate({ name: "recipes" })}
        />
        <NavItem
          active={route.name === "settings"}
          icon={<Settings className="size-4" />}
          label={t("nav.settings")}
          onClick={() => navigate({ name: "settings" })}
        />
      </nav>

      <div className="mt-4 flex items-center justify-between px-4 text-[11px] font-semibold tracking-wider text-fg-subtle uppercase">
        <span>{t("nav.recent")}</span>
        <span>{summaries.length}</span>
      </div>
      <ul className="mt-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {summaries.map((p) => (
          <ProjectRow key={p.id} project={p} active={route.name === "project" && route.id === p.id} />
        ))}
        {summaries.length === 0 && <li className="px-2 py-6 text-center text-xs text-fg-subtle">{t("projects.empty.title")}</li>}
      </ul>
    </div>
  );
}

function NavItem({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors",
        active ? "bg-bg-elevated text-fg shadow-sm" : "text-fg-muted hover:bg-bg-elevated/60 hover:text-fg",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function ProjectRow({ project, active }: { project: ProjectSummary; active: boolean }) {
  const t = useT();
  const url = useImageUrl(project.id, "thumbnail", project.coverImageId);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState(project.name);
  const { rename, remove, duplicate } = useProjectsStore.getState();

  return (
    <li className="group relative">
      <button
        type="button"
        onClick={() => navigate({ name: "project", id: project.id })}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg p-1.5 pr-9 text-left transition-colors",
          active ? "bg-bg-elevated shadow-sm" : "hover:bg-bg-elevated/60",
        )}
      >
        <div className="checkerboard size-11 shrink-0 overflow-hidden rounded-md bg-bg-sunken">
          {url && <img src={url} alt="" className="size-full object-cover" loading="lazy" decoding="async" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{project.name}</div>
          <div className="truncate text-[11px] text-fg-subtle">{t("projects.imageCount", { count: project.imageCount })}</div>
        </div>
      </button>
      <button
        type="button"
        aria-label={t("common.edit")}
        onClick={() => setMenu((v) => !v)}
        className={cn(
          "absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-1.5 text-fg-subtle hover:bg-bg-sunken hover:text-fg",
          menu ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100",
        )}
      >
        <MoreHorizontal className="size-4" />
      </button>
      {menu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} aria-hidden />
          <div className="fade-in absolute top-full right-1 z-50 mt-1 w-40 rounded-lg border border-border bg-bg-elevated p-1 shadow-app" role="menu">
            <MenuItem
              label={t("common.rename")}
              onClick={() => {
                setMenu(false);
                setName(project.name);
                setRenaming(true);
              }}
            />
            <MenuItem
              label={t("common.duplicate")}
              onClick={async () => {
                setMenu(false);
                const copy = await duplicate(project.id);
                if (copy) navigate({ name: "project", id: copy.project.id });
              }}
            />
            <MenuItem
              label={t("common.delete")}
              danger
              onClick={() => {
                setMenu(false);
                setDeleting(true);
              }}
            />
          </div>
        </>
      )}
      <Dialog
        open={renaming}
        onClose={() => setRenaming(false)}
        title={t("projects.rename.title")}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                await rename(project.id, name);
                setRenaming(false);
              }}
            >
              {t("common.save")}
            </Button>
          </>
        }
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            await rename(project.id, name);
            setRenaming(false);
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-label={t("common.name")} />
        </form>
      </Dialog>
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title={t("projects.delete.title")}
        body={t("projects.delete.body", { name: project.name })}
        confirmLabel={t("common.delete")}
        danger
        onConfirm={async () => {
          setDeleting(false);
          if (active) navigate({ name: "home" });
          await remove(project.id);
          toast.info(t("projects.deleted"));
        }}
      />
    </li>
  );
}

function MenuItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn("flex w-full items-center rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-bg-sunken", danger ? "text-danger" : "text-fg")}
    >
      {label}
    </button>
  );
}
