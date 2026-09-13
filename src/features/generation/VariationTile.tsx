import { memo, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Download, ExternalLink, GitBranch, Maximize2, RefreshCw, RotateCw, X } from "lucide-react";
import { useImageUrl } from "@/app/image-urls";
import { useComposerStore } from "@/app/stores/composer-store";
import { useGenerationStore } from "@/app/stores/generation-store";
import { toast } from "@/app/stores/toast-store";
import { useUiStore } from "@/app/stores/ui-store";
import { getServices } from "@/app/services";
import type { GenerationJob, ListingDocument } from "@/domain/models";
import { exportSingle } from "@/infrastructure/image/export";
import { GOOGLE_RATE_LIMIT_DASHBOARD } from "@/infrastructure/providers/gemini/GeminiErrors";
import { openExternal } from "@/lib/open-external";
import { useLocale, useT } from "@/i18n";
import { errorMessage } from "@/i18n/errors";
import { cn } from "@/lib/cn";
import { revealElement } from "@/lib/scroll";
import { ToPostCheckbox } from "../gallery/ToPostCheckbox";

interface Props {
  job: GenerationJob;
  doc: ListingDocument;
}

const QUOTA_CODES = new Set(["RATE_LIMITED", "QUOTA_EXCEEDED", "MODEL_NOT_IN_PLAN", "FREE_TIER_NO_ACCESS"]);

export const VariationTile = memo(function VariationTile({ job, doc }: Props) {
  const t = useT();
  const locale = useLocale();
  const shotName = job.shotLabel?.[locale] ?? t("generation.variation", { index: job.index });
  const asset = job.resultImageId ? doc.images[job.resultImageId] : undefined;
  const url = useImageUrl(doc.listing.id, "thumbnail", asset?.id);
  const selected = useUiStore((s) => (asset ? s.selection.has(asset.id) : false));
  const toggleSelected = useUiStore((s) => s.toggleSelected);
  const openLightbox = useUiStore((s) => s.openLightbox);
  const isToPost = !!asset && doc.toPost.includes(asset.id);
  const retryJob = useGenerationStore((s) => s.retryJob);
  const cancel = () => getServices().queue.cancel(job.id);
  const reveal = useUiStore((s) => s.revealJobId === job.id);
  const revealJob = useUiStore((s) => s.revealJob);
  const tileRef = useRef<HTMLElement>(null);
  // A photo just regenerated: bring its tile on screen (the card may be far below on a phone).
  useEffect(() => {
    if (!reveal) return;
    revealElement(tileRef.current);
    revealJob(null);
  }, [reveal, revealJob]);

  const source = doc.images[job.sourceImageId];
  const ratio = asset ? asset.width / asset.height : ratioFor(job, source ? source.width / source.height : 1);

  if (job.status === "completed" && asset) {
    return (
      <figure
        ref={tileRef}
        className={cn(
          "group checkerboard fade-in relative overflow-hidden rounded-xl border bg-bg-sunken transition-[border,box-shadow]",
          selected ? "border-accent ring-2 ring-ring" : "border-border",
        )}
        style={{ aspectRatio: ratio }}
      >
        <button
          type="button"
          className="absolute inset-0"
          onClick={(e) => (e.shiftKey || e.ctrlKey || e.metaKey ? toggleSelected(asset.id) : openLightbox(asset.id))}
          aria-label={t("gallery.fullscreen")}
        >
          {url ? (
            <img src={url} alt={`${shotName}: ${job.prompt}`} className="size-full object-cover" loading="lazy" decoding="async" />
          ) : (
            <div className="shimmer size-full" />
          )}
        </button>

        <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-b from-black/50 to-transparent opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/60 to-transparent opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100" />

        <div className="absolute top-2 left-2 flex items-center gap-1.5">
          <button
            type="button"
            role="checkbox"
            aria-checked={selected}
            aria-label={t("common.select")}
            onClick={() => toggleSelected(asset.id)}
            className={cn(
              "flex size-6 items-center justify-center rounded-md border text-white backdrop-blur transition-opacity",
              selected ? "border-accent bg-accent opacity-100" : "border-white/60 bg-black/40 opacity-0 group-hover:opacity-100 focus:opacity-100",
            )}
          >
            {selected && <Check className="size-3.5 text-accent-fg" />}
          </button>
          <span className="rounded-md bg-black/45 px-1.5 py-0.5 text-[11px] font-medium text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100">
            {job.index}
          </span>
        </div>

        <div className="absolute top-2 right-2 flex items-center gap-1">
          <TileButton onClick={() => openLightbox(asset.id)} label={t("gallery.fullscreen")}>
            <Maximize2 className="size-3.5" />
          </TileButton>
          <ToPostCheckbox assetId={asset.id} checked={isToPost} />
        </div>

        <div className="absolute inset-x-2 bottom-2 flex items-center justify-between gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
          <RegenerateButton jobId={job.id} />
          <div className="flex items-center gap-1">
            <UseAsSourceButton assetId={asset.id} />
            <TileButton
              onClick={async () => {
                const blob = await getServices().storage.readImage(doc.listing.id, "generation", asset.id);
                if (blob) await exportSingle({ blob, name: `${doc.listing.name}-${job.index}` }, { type: asset.mimeType });
              }}
              label={t("common.download")}
            >
              <Download className="size-3.5" />
            </TileButton>
          </div>
        </div>
      </figure>
    );
  }

  if (job.status === "queued" || job.status === "generating") {
    return (
      <div
        ref={tileRef as React.RefObject<HTMLDivElement>}
        className="relative overflow-hidden rounded-xl border border-border bg-bg-sunken"
        style={{ aspectRatio: ratio }}
        aria-busy
      >
        <div className="shimmer absolute inset-0" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 p-3 text-center">
          <span className="size-2 animate-pulse rounded-full bg-accent" />
          <span className="text-xs font-medium">{shotName}</span>
          <span className="text-[11px] text-fg-muted">
            {job.status === "queued" ? (
              t("generation.status.queued")
            ) : job.nextRetryAt ? (
              <RetryCountdown at={job.nextRetryAt} />
            ) : (
              t("generation.status.generating")
            )}
          </span>
          {job.attempt > 1 && <span className="text-[11px] text-fg-subtle">{t("generation.attempt", { attempt: job.attempt })}</span>}
          {job.error && job.nextRetryAt && <span className="text-[11px] text-warning">{errorMessage(job.error, job.provider)}</span>}
        </div>
        <button
          type="button"
          onClick={cancel}
          aria-label={t("common.cancel")}
          className="absolute top-2 right-2 rounded-md bg-black/40 p-1 text-white hover:bg-black/60"
        >
          <X className="size-3.5" />
        </button>
      </div>
    );
  }

  // failed / cancelled
  const isCancelled = job.status === "cancelled";
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 rounded-xl border p-3 text-center",
        isCancelled ? "border-border bg-bg-sunken/60" : "border-danger/30 bg-danger/5",
      )}
      style={{ aspectRatio: ratio }}
    >
      {isCancelled ? <X className="size-5 text-fg-subtle" /> : <AlertTriangle className="size-5 text-danger" />}
      <span className="text-xs font-medium">{shotName}</span>
      <span className="text-[11px] text-fg-muted">
        {isCancelled ? t("generation.status.cancelled") : job.error ? errorMessage(job.error, job.provider) : t("generation.status.failed")}
      </span>
      {job.error?.detail && !isCancelled && (
        <span className="line-clamp-2 text-[10px] text-fg-subtle" title={job.error.detail}>
          {job.error.detail}
        </span>
      )}
      <button
        type="button"
        onClick={() => retryJob(job.id)}
        className="inline-flex items-center gap-1 rounded-md border border-border bg-bg-elevated px-2 py-1 text-xs font-medium hover:border-border-strong"
      >
        <RotateCw className="size-3" /> {t("common.retry")}
      </button>
      {job.provider === "gemini" && job.error && QUOTA_CODES.has(job.error.code) && (
        <button
          type="button"
          onClick={() => void openExternal(GOOGLE_RATE_LIMIT_DASHBOARD)}
          className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline"
        >
          {t("usage.googleDashboard")} <ExternalLink className="size-3" />
        </button>
      )}
    </div>
  );
});

function ratioFor(job: GenerationJob, sourceRatio: number): number {
  if (job.aspectRatio === "original") return sourceRatio;
  const [w, h] = job.aspectRatio.split(":").map(Number) as [number, number];
  return w / h;
}

function TileButton({ children, onClick, label }: { children: React.ReactNode; onClick: () => void | Promise<void>; label: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        void onClick();
      }}
      aria-label={label}
      title={label}
      className="flex size-7 items-center justify-center rounded-md bg-black/45 text-white opacity-0 backdrop-blur transition-opacity group-hover:opacity-100 hover:bg-black/70 focus:opacity-100"
    >
      {children}
    </button>
  );
}

/** One more photo of this shot (same prompt, source and settings, fresh seed) as a new tile in the same card. */
function RegenerateButton({ jobId }: { jobId: string }) {
  const t = useT();
  const regenerateJob = useGenerationStore((s) => s.regenerateJob);
  const revealJob = useUiStore((s) => s.revealJob);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        const id = regenerateJob(jobId);
        if (id) revealJob(id);
      }}
      aria-label={t("generation.regenerateShot")}
      title={t("generation.regenerateShot")}
      className="flex size-7 items-center justify-center rounded-md bg-accent text-accent-fg shadow hover:brightness-110"
    >
      <RefreshCw className="size-3.5" />
    </button>
  );
}

function UseAsSourceButton({ assetId }: { assetId: string }) {
  const t = useT();
  const setSource = useComposerStore((s) => s.setSource);
  return (
    <TileButton
      onClick={() => {
        setSource(assetId);
        toast.info(t("generation.sourceSet"));
        document.getElementById("prompt")?.focus();
      }}
      label={t("generation.useAsSource")}
    >
      <GitBranch className="size-3.5" />
    </TileButton>
  );
}

function RetryCountdown({ at }: { at: string }) {
  const t = useT();
  const [seconds, setSeconds] = useState(() => Math.max(0, Math.ceil((Date.parse(at) - Date.now()) / 1000)));
  useEffect(() => {
    const id = setInterval(() => setSeconds(Math.max(0, Math.ceil((Date.parse(at) - Date.now()) / 1000))), 500);
    return () => clearInterval(id);
  }, [at]);
  return <>{t("generation.retryingIn", { seconds })}</>;
}
