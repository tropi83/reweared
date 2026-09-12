import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, GitBranch, Pencil, RefreshCw, RotateCw, Sparkles, Square, Trash2 } from "lucide-react";
import { useComposerStore } from "@/app/stores/composer-store";
import { useGenerationStore } from "@/app/stores/generation-store";
import { useListingsStore } from "@/app/stores/listings-store";
import { toast } from "@/app/stores/toast-store";
import { useUiStore } from "@/app/stores/ui-store";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Badge, EmptyState } from "@/components/ui/Misc";
import type { Generation, GenerationJob, ListingDocument } from "@/domain/models";
import { useLocale, useT } from "@/i18n";
import { findSubcategory } from "@/domain/services/catalog";
import { formatRelative } from "@/lib/format";
import { VariationTile } from "./VariationTile";

export function GenerationFeed() {
  const t = useT();
  const doc = useListingsStore((s) => s.current);
  const filter = useUiStore((s) => s.filter);
  const generations = useMemo(() => (doc ? Object.values(doc.generations).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : []), [doc]);
  useScrollToNewGeneration(doc?.listing.id, generations);

  if (!doc) return null;
  if (generations.length === 0) {
    return <EmptyState icon={<Sparkles className="size-10" />} title={t("generation.empty")} body={t("generation.emptyBody")} />;
  }
  return (
    <div className="space-y-6 p-4 md:p-5">
      {generations.map((gen) => (
        <GenerationCard key={gen.id} generation={gen} doc={doc} toPostOnly={filter === "toPost"} />
      ))}
    </div>
  );
}

const generationDomId = (id: string) => `generation-${id}`;

/**
 * On phones the feed sits under the listing card, so a run that starts is out of sight: scroll its card
 * into view once. Generations already there when the listing opens are left alone.
 */
function useScrollToNewGeneration(listingId: string | undefined, generations: Generation[]): void {
  const seen = useRef<{ listingId: string | undefined; ids: Set<string> } | null>(null);
  useEffect(() => {
    const ids = new Set(generations.map((g) => g.id));
    const previous = seen.current;
    seen.current = { listingId, ids };
    if (!previous || previous.listingId !== listingId) return;
    const fresh = generations.find((g) => !previous.ids.has(g.id));
    if (!fresh) return;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(generationDomId(fresh.id))?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  }, [listingId, generations]);
}

function GenerationCard({ generation, doc, toPostOnly }: { generation: Generation; doc: ListingDocument; toPostOnly: boolean }) {
  const t = useT();
  const locale = useLocale();
  const pack = generation.category ? findSubcategory(generation.category) : undefined;
  const title = pack ? `${t("listing.pack")} · ${pack.category.label[locale]} › ${pack.subcategory.label[locale]}` : generation.prompt;
  const composer = useComposerStore();
  const { retryFailed, cancelGeneration, start } = useGenerationStore.getState();
  const deleteGeneration = useListingsStore((s) => s.deleteGeneration);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const jobs = generation.jobIds.map((id) => doc.jobs[id]).filter((j): j is GenerationJob => !!j);
  const visibleJobs = toPostOnly ? jobs.filter((j) => j.resultImageId && doc.toPost.includes(j.resultImageId)) : jobs;
  if (toPostOnly && visibleJobs.length === 0) return null;

  const completed = jobs.filter((j) => j.status === "completed").length;
  const failed = jobs.filter((j) => j.status === "failed" || j.status === "cancelled").length;
  const active = generation.status === "active";
  const source = doc.images[generation.sourceImageId];
  const fromOriginal = generation.sourceImageId === doc.listing.originalImageId;
  const parent = generation.parentGenerationId ? doc.generations[generation.parentGenerationId] : undefined;
  const parentJob = source?.jobId ? doc.jobs[source.jobId] : undefined;

  const regenerate = async () => {
    // Listing packs re-run the same shots (prompts live on the jobs), free prompts re-run as before.
    const packShots = generation.category
      ? generation.jobIds
          .map((id) => doc.jobs[id])
          .filter((j): j is GenerationJob => !!j)
          .map((j) => ({ id: j.shotId ?? String(j.index), label: j.shotLabel ?? { en: `Shot ${j.index}`, fr: `Prise ${j.index}` }, prompt: j.prompt }))
      : undefined;
    try {
      await start({
        sourceImageId: generation.sourceImageId,
        prompt: generation.prompt,
        ...(packShots ? { shots: packShots, category: generation.category } : {}),
        providerId: generation.settings.providerId,
        modelId: generation.settings.modelId,
        aspectRatio: generation.settings.aspectRatio,
        ...(generation.settings.imageSize ? { imageSize: generation.settings.imageSize } : {}),
        ...(generation.settings.providerOptions ? { providerOptions: generation.settings.providerOptions } : {}),
        variationCount: generation.settings.variationCount,
      });
    } catch {
      toast.error(t("error.UNKNOWN_ERROR"));
    }
  };

  const editPrompt = () => {
    composer.loadFromGeneration({
      prompt: generation.prompt,
      sourceImageId: fromOriginal ? null : generation.sourceImageId,
      aspectRatio: generation.settings.aspectRatio,
      imageSize: generation.settings.imageSize,
      variationCount: generation.settings.variationCount,
      providerId: generation.settings.providerId,
      modelId: generation.settings.modelId,
      generationId: generation.id,
      ...(generation.settings.providerOptions ? { providerOptions: generation.settings.providerOptions } : {}),
    });
    document.getElementById("prompt")?.focus();
  };

  return (
    <article
      id={generationDomId(generation.id)}
      className="fade-in scroll-mt-4 rounded-2xl border border-border bg-bg-elevated/60 p-3 md:p-4"
      aria-label={generation.prompt}
    >
      <header className="mb-3 flex flex-wrap items-start gap-2">
        <div className="min-w-[14rem] flex-1">
          <button type="button" className="w-full text-left" onClick={() => setExpanded((v) => !v)} title={generation.prompt}>
            <p className={expanded ? "text-sm leading-relaxed" : "line-clamp-2 text-sm leading-relaxed"}>{title}</p>
            {expanded && pack && (
              <ol className="mt-2 space-y-1 text-xs text-fg-muted">
                {generation.jobIds.map((id) => {
                  const job = doc.jobs[id];
                  return job ? (
                    <li key={id}>
                      <span className="font-medium text-fg">{job.shotLabel?.[locale] ?? job.index}</span> — {job.prompt}
                    </li>
                  ) : null;
                })}
              </ol>
            )}
          </button>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-subtle">
            <Badge tone={fromOriginal ? "neutral" : "accent"}>
              <GitBranch className="size-3" />
              {fromOriginal
                ? t("generation.branchFromOriginal")
                : `${t("generation.branchFrom")}${parentJob ? ` ${parentJob.index}` : ""}${parent ? ` · ${truncate(parent.prompt, 24)}` : ""}`}
            </Badge>
            <Badge>{generation.settings.modelId}</Badge>
            {generation.settings.aspectRatio !== "original" && <Badge>{generation.settings.aspectRatio}</Badge>}
            {generation.settings.imageSize && <Badge>{generation.settings.imageSize}</Badge>}
            <span>{formatRelative(generation.createdAt)}</span>
            <span aria-live="polite">· {active ? t("composer.generating", { done: completed, total: jobs.length }) : `${completed} / ${jobs.length}`}</span>
          </div>
        </div>
        <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1">
          {active ? (
            <Button variant="ghost" size="sm" leftIcon={<Square className="size-3.5" />} onClick={() => cancelGeneration(generation.id)}>
              {t("common.cancel")}
            </Button>
          ) : (
            <>
              {failed > 0 && (
                <Button variant="secondary" size="sm" leftIcon={<RotateCw className="size-3.5" />} onClick={() => retryFailed(generation.id)}>
                  {t("generation.retryFailed")}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<RefreshCw className="size-3.5" />}
                onClick={() => void regenerate()}
                title={t("generation.regenerate")}
              >
                <span className="hidden sm:inline">{t("generation.regenerate")}</span>
              </Button>
              {!generation.category && (
                <Button variant="ghost" size="sm" leftIcon={<Pencil className="size-3.5" />} onClick={editPrompt} title={t("generation.editPrompt")}>
                  <span className="hidden sm:inline">{t("generation.editPrompt")}</span>
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(generation.prompt);
                  toast.info(t("common.copied"));
                }}
                aria-label={t("gallery.copyPrompt")}
                title={t("gallery.copyPrompt")}
              >
                <Copy className="size-3.5" />
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={() => setConfirmDelete(true)} aria-label={t("generation.delete")} title={t("generation.delete")}>
                <Trash2 className="size-3.5" />
              </Button>
            </>
          )}
        </div>
      </header>

      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 200px), 1fr))" }}>
        {visibleJobs.map((job) => (
          <VariationTile key={job.id} job={job} doc={doc} />
        ))}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t("generation.delete")}
        body={t("generation.delete.body", { count: completed })}
        confirmLabel={t("common.delete")}
        danger
        onConfirm={async () => {
          setConfirmDelete(false);
          await deleteGeneration(generation.id);
        }}
      />
    </article>
  );
}

function truncate(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
