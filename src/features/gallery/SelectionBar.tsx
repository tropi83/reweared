import { useState } from "react";
import { Download, Trash2, X } from "lucide-react";
import { useProjectsStore } from "@/app/stores/projects-store";
import { toast } from "@/app/stores/toast-store";
import { useUiStore } from "@/app/stores/ui-store";
import { getServices } from "@/app/services";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { Label } from "@/components/ui/Input";
import { Segmented } from "@/components/ui/Misc";
import type { ImageMimeType } from "@/domain/models";
import { exportMany, type ExportItem } from "@/infrastructure/image/export";
import { useT } from "@/i18n";

export function SelectionBar() {
  const t = useT();
  const selection = useUiStore((s) => s.selection);
  const clear = useUiStore((s) => s.clearSelection);
  const doc = useProjectsStore((s) => s.current);
  const [exportOpen, setExportOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const deleteImages = useProjectsStore((s) => s.deleteImages);

  if (!doc || selection.size === 0) return null;
  const ids = [...selection].filter((id) => doc.images[id]);

  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-40 flex justify-center px-4">
        <div
          className="fade-in pointer-events-auto flex items-center gap-2 rounded-2xl border border-border bg-bg-elevated/95 px-3 py-2 shadow-app backdrop-blur"
          role="toolbar"
          aria-label={t("common.selectedCount", { count: ids.length })}
        >
          <span className="px-1 text-sm font-medium">{t("common.selectedCount", { count: ids.length })}</span>
          <Button variant="primary" size="sm" leftIcon={<Download className="size-3.5" />} onClick={() => setExportOpen(true)}>
            {t("gallery.downloadSelected", { count: ids.length })}
          </Button>
          <Button variant="danger" size="sm" leftIcon={<Trash2 className="size-3.5" />} onClick={() => setConfirmDelete(true)}>
            {t("common.delete")}
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={clear} aria-label={t("common.clearSelection")} title={t("common.clearSelection")}>
            <X className="size-4" />
          </Button>
        </div>
      </div>

      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} assetIds={ids} />

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t("gallery.deleteImages.title")}
        body={t("gallery.deleteImages.body", { count: ids.length })}
        confirmLabel={t("common.delete")}
        danger
        busy={busy}
        onConfirm={async () => {
          setBusy(true);
          try {
            await deleteImages(ids);
            clear();
          } finally {
            setBusy(false);
            setConfirmDelete(false);
          }
        }}
      />
    </>
  );
}

export function ExportDialog({ open, onClose, assetIds }: { open: boolean; onClose: () => void; assetIds: string[] }) {
  const t = useT();
  const doc = useProjectsStore((s) => s.current);
  const [type, setType] = useState<ImageMimeType>("image/png");
  const [quality, setQuality] = useState(92);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!doc) return;
    setBusy(true);
    try {
      const { storage } = getServices();
      const items: ExportItem[] = [];
      for (const id of assetIds) {
        const asset = doc.images[id];
        if (!asset) continue;
        const blob = await storage.readImage(doc.project.id, asset.kind, asset.id);
        if (!blob) continue;
        const job = asset.jobId ? doc.jobs[asset.jobId] : undefined;
        items.push({ blob, name: `${doc.project.name}-${job ? `variation-${job.index}` : "original"}-${asset.id.slice(-6)}` });
      }
      const ok = await exportMany(items, { type, quality: quality / 100 }, doc.project.name);
      if (ok) toast.success(t("gallery.exported", { count: items.length }));
      onClose();
    } catch {
      toast.error(t("gallery.exportFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("gallery.downloadSelected", { count: assetIds.length })}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" onClick={() => void run()} loading={busy} leftIcon={<Download className="size-4" />}>
            {assetIds.length > 1 ? t("gallery.downloadZip") : t("common.download")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label>{t("gallery.exportFormat")}</Label>
          <Segmented
            ariaLabel={t("gallery.exportFormat")}
            value={type}
            onChange={setType}
            options={[
              { value: "image/png", label: "PNG" },
              { value: "image/jpeg", label: "JPEG" },
              { value: "image/webp", label: "WebP" },
            ]}
          />
        </div>
        {type !== "image/png" && (
          <div className="space-y-1.5">
            <Label htmlFor="quality" hint={`${quality}%`}>
              {t("gallery.exportQuality")}
            </Label>
            <input
              id="quality"
              type="range"
              min={50}
              max={100}
              value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
              className="w-full accent-[var(--accent)]"
            />
          </div>
        )}
      </div>
    </Dialog>
  );
}
