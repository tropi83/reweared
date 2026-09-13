import { CheckCircle2, GitBranch, Maximize2, RotateCcw } from "lucide-react";
import { useImageUrl } from "@/app/image-urls";
import { useComposerStore } from "@/app/stores/composer-store";
import { useListingsStore } from "@/app/stores/listings-store";
import { useUiStore } from "@/app/stores/ui-store";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Misc";
import { useT } from "@/i18n";
import { ToPostCheckbox } from "../gallery/ToPostCheckbox";
import { ImportDropzone } from "./HomeView";

/** Shows the image that will be sent with the next generation (original or a chosen variation). */
export function SourcePanel() {
  const t = useT();
  const doc = useListingsStore((s) => s.current);
  const sourceImageId = useComposerStore((s) => s.sourceImageId);
  const setSource = useComposerStore((s) => s.setSource);
  const openLightbox = useUiStore((s) => s.openLightbox);

  const originalId = doc?.listing.originalImageId;
  const effectiveId = sourceImageId && doc?.images[sourceImageId] ? sourceImageId : originalId;
  const asset = effectiveId ? doc?.images[effectiveId] : undefined;
  const url = useImageUrl(doc?.listing.id, "thumbnail", effectiveId);
  const isOriginal = effectiveId === originalId;
  const parentGeneration = asset?.generationId ? doc?.generations[asset.generationId] : undefined;

  if (!doc || !asset) {
    return <ImportDropzone compact />;
  }
  const isToPost = doc.toPost.includes(asset.id);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-fg-muted">{t("composer.sourceLabel")}</span>
        <div className="flex min-w-0 items-center gap-1">
          {isToPost && (
            <Badge tone="accent">
              <CheckCircle2 className="size-3" /> {t("gallery.toPost")}
            </Badge>
          )}
          {isOriginal ? (
            <Badge>{t("composer.sourceOriginal")}</Badge>
          ) : (
            <Badge tone="accent">
              <GitBranch className="size-3" /> {t("generation.branchFrom")}
            </Badge>
          )}
        </div>
      </div>
      <div className="group checkerboard relative overflow-hidden rounded-xl border border-border bg-bg-sunken">
        <div className="flex max-h-64 items-center justify-center">
          {url ? (
            <img src={url} alt="" className="max-h-64 w-full object-contain" style={{ aspectRatio: `${asset.width} / ${asset.height}` }} />
          ) : (
            <div className="shimmer h-48 w-full" />
          )}
        </div>
        <div className="absolute top-2 right-2 flex items-center gap-1">
          <Button
            variant="secondary"
            size="icon-sm"
            onClick={() => openLightbox(asset.id)}
            aria-label={t("gallery.fullscreen")}
            title={t("gallery.fullscreen")}
            className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          >
            <Maximize2 className="size-3.5" />
          </Button>
          <ToPostCheckbox assetId={asset.id} checked={isToPost} />
        </div>
        <div className="absolute bottom-2 left-2 rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] text-white backdrop-blur">
          {asset.width} × {asset.height}
        </div>
      </div>
      {!isOriginal && (
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 truncate text-xs text-fg-muted" title={parentGeneration?.prompt}>
            {parentGeneration ? t("composer.sourceGenerated", { prompt: parentGeneration.prompt }) : ""}
          </p>
          <Button variant="ghost" size="sm" leftIcon={<RotateCcw className="size-3.5" />} onClick={() => setSource(null)}>
            {t("composer.resetSource")}
          </Button>
        </div>
      )}
    </div>
  );
}
