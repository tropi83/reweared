import { useState } from "react";
import { Check, Copy, ExternalLink, FolderDown, Send, X } from "lucide-react";
import { getServices } from "@/app/services";
import { useListingsStore } from "@/app/stores/listings-store";
import { postEligibility, usePublishStore } from "@/app/stores/publish-store";
import { toast } from "@/app/stores/toast-store";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Misc";
import { toGenerationError } from "@/domain/models";
import { orderedPhotoIds, type FieldFillResult, type PublishStage } from "@/domain/services/publish";
import { exportMany, type ExportItem } from "@/infrastructure/image/export";
import { useT, type MessageKey } from "@/i18n";
import { errorMessage } from "@/i18n/errors";

const STEP_KEY: Record<Exclude<PublishStage, "closed">, MessageKey> = {
  login: "publish.step.login",
  browsing: "publish.step.browse",
  form: "publish.step.form",
  filled: "publish.step.filled",
};

const RESULT_TONE: Record<FieldFillResult, "accent" | "success" | "warning" | "danger"> = {
  ready: "accent",
  filled: "success",
  not_found: "warning",
  failed: "danger",
};

function ResultRow({ label, value }: { label: string; value: FieldFillResult }) {
  const t = useT();
  return (
    <li className="flex items-center justify-between gap-2 text-sm">
      <span>{label}</span>
      <Badge tone={RESULT_TONE[value]}>{t(`publish.report.${value}` as MessageKey)}</Badge>
    </li>
  );
}

/** Replaces the workspace column while the Vinted window is open for the current listing. */
export function PublishPanel() {
  const t = useT();
  const doc = useListingsStore((s) => s.current);
  const session = usePublishStore((s) => s.session);
  const focus = usePublishStore((s) => s.focus);
  const openForm = usePublishStore((s) => s.openForm);
  const fill = usePublishStore((s) => s.fill);
  const finish = usePublishStore((s) => s.finish);
  const [exporting, setExporting] = useState(false);

  if (!doc || session.stage === "closed" || session.listingId !== doc.listing.id) return null;
  const count = orderedPhotoIds(doc).length;
  const postable = postEligibility(doc).ok;
  const copy = doc.listing.copy;
  const report = session.report;
  const incomplete = !!report && (report.title !== "filled" || report.description !== "filled" || report.photos.attached < report.photos.requested);
  const onForm = session.stage === "form" || session.stage === "filled";
  // Phones: the native Vinted screen does the steps itself; the panel waits, then shows what it reported.
  const delegated = getServices().publish.mode === "delegated";

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.info(t("common.copied"));
    } catch (err) {
      toast.error(errorMessage(toGenerationError(err)));
    }
  };

  // Fallback when the pre-fill misses photos: save them (posting order, JPEG) and drop them into Vinted by hand.
  const exportPhotos = async () => {
    setExporting(true);
    try {
      const { storage } = getServices();
      const items: ExportItem[] = [];
      for (const id of orderedPhotoIds(doc)) {
        const asset = doc.images[id];
        const blob = asset && (await storage.readImage(doc.listing.id, asset.kind, asset.id));
        if (blob) items.push({ blob, name: `${doc.listing.name}-${items.length + 1}` });
      }
      if (await exportMany(items, { type: "image/jpeg", quality: 0.92 }, `${doc.listing.name}-vinted`)) {
        toast.info(t("gallery.exported", { count: items.length }));
      }
    } catch (err) {
      toast.error(errorMessage(toGenerationError(err)));
    } finally {
      setExporting(false);
    }
  };

  return (
    <section className="flex flex-1 flex-col gap-4" aria-label={t("publish.panel.title")}>
      <div className="flex items-center justify-between">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
          <Send className="size-4" /> {t("publish.panel.title")}
        </h2>
        <Button variant="ghost" size="icon-sm" onClick={() => void finish()} aria-label={t("common.close")} title={t("common.close")}>
          <X className="size-4" />
        </Button>
      </div>

      <p className="text-sm text-fg-muted" role="status" aria-live="polite">
        {delegated ? (session.busy ? t("publish.step.delegated") : t("publish.step.filled")) : t(STEP_KEY[session.stage])}
      </p>

      {!delegated && (
        <div className="flex flex-col gap-2">
          <Button variant="secondary" leftIcon={<ExternalLink className="size-4" />} onClick={() => void focus()}>
            {t("publish.action.focus")}
          </Button>
          {onForm ? (
            <Button variant="primary" loading={session.busy} disabled={session.busy || !postable} onClick={() => void fill()}>
              {session.busy ? t("publish.action.filling") : t("publish.action.fill", { count })}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void openForm()}>
              {t("publish.action.openForm")}
            </Button>
          )}
        </div>
      )}

      {session.error && (
        <p className="text-xs text-danger" role="alert">
          {errorMessage(session.error, "vinted")}
        </p>
      )}

      {report && (
        <div className="space-y-2 rounded-lg border border-border bg-bg-elevated/60 p-3">
          {!report.pageOk && <p className="text-xs text-warning">{t("publish.report.notForm")}</p>}
          <ul className="space-y-1">
            <ResultRow label={t("publish.report.title")} value={report.title} />
            <ResultRow label={t("publish.report.description")} value={report.description} />
            <li className="flex items-center justify-between gap-2 text-sm">
              <span>{t("publish.report.photos")}</span>
              <Badge tone={report.photos.attached >= report.photos.requested ? "success" : "warning"}>{t("publish.report.attached", report.photos)}</Badge>
            </li>
          </ul>
          {incomplete && report.pageOk && <p className="text-xs text-fg-subtle">{t("publish.report.hint")}</p>}
        </div>
      )}

      <div className="mt-auto space-y-2 border-t border-border pt-3">
        <div className="flex flex-wrap gap-1.5">
          {copy && (
            <>
              <Button variant="ghost" size="sm" leftIcon={<Copy className="size-3.5" />} onClick={() => void copyText(copy.title)}>
                {t("copy.field.title")}
              </Button>
              <Button variant="ghost" size="sm" leftIcon={<Copy className="size-3.5" />} onClick={() => void copyText(copy.description)}>
                {t("copy.field.description")}
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            loading={exporting}
            disabled={exporting || count === 0}
            leftIcon={<FolderDown className="size-3.5" />}
            onClick={() => void exportPhotos()}
          >
            {t("publish.action.exportPhotos")}
          </Button>
        </div>
        {session.stage === "filled" && (
          <Button variant="primary" className="w-full" leftIcon={<Check className="size-4" />} onClick={() => void finish()}>
            {t("publish.action.finish")}
          </Button>
        )}
      </div>
    </section>
  );
}
