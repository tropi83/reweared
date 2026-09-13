import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, Columns2, Download, GitBranch, Info, RefreshCw, X, ZoomIn, ZoomOut } from "lucide-react";
import { useImageUrl } from "@/app/image-urls";
import { useComposerStore } from "@/app/stores/composer-store";
import { useGenerationStore } from "@/app/stores/generation-store";
import { useListingsStore } from "@/app/stores/listings-store";
import { toast } from "@/app/stores/toast-store";
import { useUiStore } from "@/app/stores/ui-store";
import { getServices } from "@/app/services";
import { Button } from "@/components/ui/Button";
import type { ImageAsset } from "@/domain/models";
import { exportSingle } from "@/infrastructure/image/export";
import { useLocale, useT } from "@/i18n";
import { cn } from "@/lib/cn";

/** Fullscreen viewer with zoom/pan, keyboard navigation, side-by-side compare and metadata. */
export function Lightbox() {
  const t = useT();
  const locale = useLocale();
  const doc = useListingsStore((s) => s.current);
  const assetId = useUiStore((s) => s.lightboxAssetId);
  const close = useUiStore((s) => s.closeLightbox);
  const open = useUiStore((s) => s.openLightbox);
  const compare = useUiStore((s) => s.compareMode);
  const setCompare = useUiStore((s) => s.setCompareMode);
  const toggleToPost = useListingsStore((s) => s.toggleToPost);
  const setSource = useComposerStore((s) => s.setSource);
  const regenerateJob = useGenerationStore((s) => s.regenerateJob);
  const [info, setInfo] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragging = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const ordered = useMemo(() => {
    if (!doc) return [] as ImageAsset[];
    return Object.values(doc.images).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [doc]);
  const index = ordered.findIndex((a) => a.id === assetId);
  const asset = index >= 0 ? ordered[index] : undefined;
  const job = asset?.jobId ? doc?.jobs[asset.jobId] : undefined;
  const generation = asset?.generationId ? doc?.generations[asset.generationId] : undefined;
  const sourceAsset = generation ? doc?.images[generation.sourceImageId] : undefined;
  const url = useImageUrl(doc?.listing.id, asset?.kind ?? "generation", asset?.id);
  const sourceUrl = useImageUrl(doc?.listing.id, sourceAsset?.kind ?? "original", compare ? sourceAsset?.id : undefined);
  const isToPost = !!asset && !!doc && doc.toPost.includes(asset.id);

  const go = useCallback(
    (delta: number) => {
      if (ordered.length === 0 || index < 0) return;
      const next = ordered[(index + delta + ordered.length) % ordered.length];
      if (next) open(next.id);
    },
    [ordered, index, open],
  );

  const viewKey = `${assetId ?? ""}:${compare}`;
  const [lastViewKey, setLastViewKey] = useState(viewKey);
  if (lastViewKey !== viewKey) {
    setLastViewKey(viewKey);
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  useEffect(() => {
    if (!assetId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(6, z * 1.25));
      else if (e.key === "-") setZoom((z) => Math.max(1, z / 1.25));
      else if (e.key === "0") {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      } else if (e.key.toLowerCase() === "c" && sourceAsset) setCompare(!compare);
      else if (e.key.toLowerCase() === "f" && asset) toggleToPost(asset.id);
      else if (e.key.toLowerCase() === "i") setInfo((v) => !v);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [assetId, close, go, compare, setCompare, sourceAsset, asset, toggleToPost]);

  if (!doc || !asset || !assetId) return null;

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.min(6, Math.max(1, z * (e.deltaY < 0 ? 1.1 : 0.9))));
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (zoom === 1) return;
    dragging.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    setPan({ x: dragging.current.px + (e.clientX - dragging.current.x), y: dragging.current.py + (e.clientY - dragging.current.y) });
  };
  const onPointerUp = () => {
    dragging.current = null;
  };

  const download = async () => {
    const blob = await getServices().storage.readImage(doc.listing.id, asset.kind, asset.id);
    if (blob) await exportSingle({ blob, name: `${doc.listing.name}-${job?.index ?? "original"}` }, { type: asset.mimeType });
  };

  const imageStyle = { transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, cursor: zoom > 1 ? "grab" : "zoom-in" } as const;

  return (
    <div
      className="fade-in fixed inset-0 z-50 flex flex-col bg-[#08080a] pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] text-white"
      role="dialog"
      aria-modal="true"
      aria-label={t("gallery.fullscreen")}
    >
      <header className="flex h-12 shrink-0 items-center gap-1 px-2 sm:px-3">
        <span className="min-w-0 truncate px-2 text-sm text-white/80">
          {job ? (job.shotLabel?.[locale] ?? t("generation.variation", { index: job.index })) : t("gallery.original")} · {index + 1} / {ordered.length}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          {sourceAsset && (
            <LbButton active={compare} onClick={() => setCompare(!compare)} label={t("gallery.compareWithOriginal")}>
              <Columns2 className="size-4" />
            </LbButton>
          )}
          <LbButton onClick={() => setZoom((z) => Math.max(1, z / 1.25))} label={t("gallery.zoomOut")}>
            <ZoomOut className="size-4" />
          </LbButton>
          <LbButton onClick={() => setZoom((z) => Math.min(6, z * 1.25))} label={t("gallery.zoomIn")}>
            <ZoomIn className="size-4" />
          </LbButton>
          <LbButton onClick={() => toggleToPost(asset.id)} label={t(isToPost ? "gallery.unToPost" : "gallery.toPost")}>
            <CheckCircle2 className={cn("size-4", isToPost && "fill-accent text-white")} />
          </LbButton>
          <LbButton onClick={() => void download()} label={t("common.download")}>
            <Download className="size-4" />
          </LbButton>
          <LbButton active={info} onClick={() => setInfo((v) => !v)} label={t("gallery.info")}>
            <Info className="size-4" />
          </LbButton>
          <LbButton onClick={close} label={t("common.close")}>
            <X className="size-5" />
          </LbButton>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <button
          type="button"
          onClick={() => go(-1)}
          aria-label={t("gallery.previous")}
          className="absolute top-1/2 left-2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 hover:bg-white/20"
        >
          <ChevronLeft className="size-6" />
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          aria-label={t("gallery.next")}
          className="absolute top-1/2 right-2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 hover:bg-white/20"
        >
          <ChevronRight className="size-6" />
        </button>

        <div className={cn("flex min-w-0 flex-1 overflow-hidden", compare && sourceAsset ? "grid grid-cols-2 gap-px" : "")} onWheel={onWheel}>
          {compare && sourceAsset && (
            <figure className="checkerboard relative flex items-center justify-center overflow-hidden bg-black">
              {sourceUrl && (
                <img
                  src={sourceUrl}
                  alt={t("gallery.source")}
                  className="max-h-full max-w-full object-contain transition-transform select-none"
                  style={imageStyle}
                  draggable={false}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                />
              )}
              <figcaption className="absolute top-3 left-3 rounded-md bg-black/60 px-2 py-0.5 text-xs">{t("gallery.source")}</figcaption>
            </figure>
          )}
          <figure className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden">
            {url ? (
              <img
                src={url}
                alt={generation?.prompt ?? ""}
                className="max-h-full max-w-full object-contain transition-transform select-none"
                style={imageStyle}
                draggable={false}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onDoubleClick={() => {
                  setZoom((z) => (z > 1 ? 1 : 2.5));
                  setPan({ x: 0, y: 0 });
                }}
              />
            ) : (
              <div className="size-6 animate-spin rounded-full border-2 border-white/40 border-t-transparent" />
            )}
            {compare && sourceAsset && (
              <figcaption className="absolute top-3 left-3 rounded-md bg-black/60 px-2 py-0.5 text-xs">{t("gallery.result")}</figcaption>
            )}
          </figure>
        </div>

        {info && (
          <aside className="fade-in w-72 shrink-0 overflow-y-auto border-l border-white/10 bg-black/60 p-4 text-sm">
            <h3 className="mb-3 text-xs font-semibold tracking-wider text-white/60 uppercase">{t("gallery.info")}</h3>
            <dl className="space-y-2.5">
              {generation && (
                <Meta label={t("gallery.metadata.prompt")}>
                  <span className="whitespace-pre-wrap">{generation.prompt}</span>
                </Meta>
              )}
              <Meta label={t("gallery.metadata.dimensions")}>
                {asset.width} × {asset.height}
              </Meta>
              {job && <Meta label={t("gallery.metadata.provider")}>{job.provider}</Meta>}
              {job && <Meta label={t("gallery.metadata.model")}>{job.model}</Meta>}
              {job && <Meta label={t("gallery.metadata.aspect")}>{job.aspectRatio}</Meta>}
              {job?.imageSize && <Meta label={t("gallery.metadata.size")}>{job.imageSize}</Meta>}
              <Meta label={t("gallery.metadata.created")}>{new Date(asset.createdAt).toLocaleString()}</Meta>
              {sourceAsset && (
                <Meta label={t("gallery.metadata.source")}>
                  <button type="button" className="text-accent hover:underline" onClick={() => open(sourceAsset.id)}>
                    {sourceAsset.id === doc.listing.originalImageId
                      ? t("gallery.original")
                      : t("generation.variation", { index: doc.jobs[sourceAsset.jobId ?? ""]?.index ?? "?" })}
                  </button>
                </Meta>
              )}
            </dl>
          </aside>
        )}
      </div>

      {asset.kind === "generation" && job && (
        <footer className="flex h-14 shrink-0 items-center justify-center gap-2 px-3">
          <Button
            variant="primary"
            leftIcon={<RefreshCw className="size-4" />}
            onClick={() => {
              if (!regenerateJob(job.id)) return;
              close();
              toast.info(t("generation.regenerateShot.started"));
            }}
          >
            {t("generation.regenerateShot")}
          </Button>
          <Button
            variant="outline"
            className="border-white/30 text-white hover:bg-white/10"
            leftIcon={<GitBranch className="size-4" />}
            onClick={() => {
              setSource(asset.id);
              close();
              toast.info(t("generation.sourceSet"));
              document.getElementById("prompt")?.focus();
            }}
          >
            {t("generation.useAsSource")}
          </Button>
        </footer>
      )}
    </div>
  );
}

function LbButton({ children, onClick, label, active }: { children: React.ReactNode; onClick: () => void; label: string; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn("rounded-md p-2 text-white/80 hover:bg-white/10 hover:text-white", active && "bg-white/15 text-white")}
    >
      {children}
    </button>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] tracking-wider text-white/50 uppercase">{label}</dt>
      <dd className="mt-0.5 break-words text-white/90">{children}</dd>
    </div>
  );
}
