import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Sparkles, Square, WandSparkles } from "lucide-react";
import { navigate } from "@/app/router";
import { getServices, MOCK_ENABLED } from "@/app/services";
import { useAuthStore } from "@/app/stores/auth-store";
import { useComposerStore } from "@/app/stores/composer-store";
import { useGenerationStore } from "@/app/stores/generation-store";
import { useListingStore } from "@/app/stores/listing-store";
import { useProjectsStore } from "@/app/stores/projects-store";
import { useRecipesStore } from "@/app/stores/recipes-store";
import { useSettingsStore } from "@/app/stores/settings-store";
import { toast } from "@/app/stores/toast-store";
import { Button } from "@/components/ui/Button";
import { Input, Label, Switch, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Segmented } from "@/components/ui/Misc";
import { ALL_ASPECT_RATIOS, toGenerationError, type AspectRatio, type ImageSize, type ListingCategoryId, type ModelInfo, type ShotSpec } from "@/domain/models";
import { buildListingShots, LISTING_CATEGORIES, listingRecipeId } from "@/domain/services/listing-catalog";
import { interpolate } from "@/domain/services/recipes";
import { MOCK_PROVIDER_ID } from "@/infrastructure/providers/mock/MockImageProvider";
import { useLocale, useT, type MessageKey } from "@/i18n";
import { errorMessage } from "@/i18n/errors";
import { cn } from "@/lib/cn";
import { UsageMeter } from "./UsageMeter";

function modelLabel(m: ModelInfo): string {
  return /^(Fast|Balanced|Professional|Legacy)$/.test(m.displayName) ? m.id : m.displayName;
}

/**
 * Listing composer: category → subcategory → four predefined shots. No free prompt; power users
 * can still pick one of their custom recipes (single prompt × N variations) or tweak the shot
 * prompts for one run.
 */
export function ListingComposer() {
  const t = useT();
  const locale = useLocale();
  const doc = useProjectsStore((s) => s.current);
  const composer = useComposerStore();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.update);
  const providerStatus = useAuthStore((s) => s.providerStatus);
  const modelsByProvider = useGenerationStore((s) => s.modelsByProvider);
  const loadModels = useGenerationStore((s) => s.loadModels);
  const start = useGenerationStore((s) => s.start);
  const cancelAll = useGenerationStore((s) => s.cancelAll);
  const setListing = useListingStore((s) => s.setListing);
  const customRecipes = useRecipesStore((s) => s.custom);

  const providerId = composer.providerId;
  const providers = [...getServices().providers.values()];
  const models = useMemo(() => modelsByProvider[providerId] ?? [], [modelsByProvider, providerId]);
  const isMock = providerId === MOCK_PROVIDER_ID;
  const authStatus = providerStatus[providerId];

  const selection = doc?.project.listing;
  const category = LISTING_CATEGORIES.find((c) => c.id === selection?.categoryId);
  const [customPrompts, setCustomPrompts] = useState<Record<string, string>>({});
  const [editShots, setEditShots] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [recipeId, setRecipeId] = useState<string>("");

  useEffect(() => {
    void loadModels(providerId, true);
  }, [providerId, authStatus?.state, authStatus?.projectId, loadModels]);

  useEffect(() => {
    if (models.length === 0) return;
    const preferred = composer.modelId ?? settings.lastModelByProvider[providerId];
    const valid = models.find((m) => m.id === preferred && m.available) ?? models.find((m) => m.available) ?? models[0];
    if (valid && valid.id !== composer.modelId) composer.setModel(valid.id);
  }, [models, composer, providerId, settings.lastModelByProvider]);

  useEffect(() => {
    composer.setAspectRatio(settings.defaultAspectRatio);
    if (settings.defaultImageSize) composer.setImageSize(settings.defaultImageSize);
    if (getServices().providers.has(settings.activeProviderId)) composer.setProvider(settings.activeProviderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const model = models.find((m) => m.id === composer.modelId);
  const aspectOptions = useMemo<AspectRatio[]>(
    () => ALL_ASPECT_RATIOS.filter((r) => r === "original" || model?.capabilities.supportedAspectRatios.includes(r)),
    [model],
  );
  const sizeOptions = useMemo(() => model?.capabilities.supportedImageSizes ?? [], [model]);
  useEffect(() => {
    if (!model) return;
    if (!aspectOptions.includes(composer.aspectRatio)) composer.setAspectRatio("original");
    if (composer.imageSize && !sizeOptions.includes(composer.imageSize)) composer.setImageSize(undefined);
  }, [model, aspectOptions, sizeOptions, composer]);

  const shots: ShotSpec[] = useMemo(() => (selection ? buildListingShots(selection) : []), [selection]);
  const effectiveShots = useMemo(() => shots.map((s) => ({ ...s, prompt: customPrompts[s.id]?.trim() || s.prompt })), [shots, customPrompts]);
  const customRecipe = customRecipes.find((r) => r.id === recipeId);

  const optionSpecs = model?.capabilities.options ?? [];
  const providerOptions = composer.providerOptions[providerId] ?? {};

  const activeJobs = doc ? Object.values(doc.jobs).filter((j) => j.status === "queued" || j.status === "generating") : [];
  const activeGeneration = activeJobs.length > 0 && doc ? doc.generations[activeJobs[0]!.generationId] : undefined;
  const activeDone = activeGeneration ? activeGeneration.jobIds.filter((id) => doc?.jobs[id]?.status === "completed").length : 0;

  const authOk = isMock || authStatus?.state === "authenticated";
  const sourceId = composer.sourceImageId ?? doc?.project.originalImageId;
  const ready = !!doc && !!sourceId && !!model?.available && authOk && (customRecipe ? true : effectiveShots.length >= 4);
  const blocker: MessageKey | null = !doc?.project.originalImageId
    ? "composer.needImage"
    : !authOk
      ? "composer.needAuth"
      : !selection && !customRecipe
        ? "listing.needCategory"
        : null;

  const changeProvider = (id: string) => {
    composer.setProvider(id);
    void updateSettings({ activeProviderId: id });
  };

  async function generate() {
    if (!ready || !doc || !sourceId || !model) return;
    try {
      if (customRecipe) {
        await start({
          sourceImageId: sourceId,
          prompt: interpolate(customRecipe.promptTemplate, {}),
          providerId,
          modelId: model.id,
          aspectRatio: composer.aspectRatio,
          ...(composer.imageSize ? { imageSize: composer.imageSize } : {}),
          variationCount: 4,
          recipeId: customRecipe.id,
          ...(Object.keys(providerOptions).length > 0 ? { providerOptions } : {}),
        });
      } else if (selection) {
        await start({
          sourceImageId: sourceId,
          prompt: "",
          providerId,
          modelId: model.id,
          aspectRatio: composer.aspectRatio,
          ...(composer.imageSize ? { imageSize: composer.imageSize } : {}),
          variationCount: effectiveShots.length,
          recipeId: listingRecipeId(selection),
          listing: selection,
          shots: effectiveShots,
          ...(Object.keys(providerOptions).length > 0 ? { providerOptions } : {}),
        });
      }
      if (settings.lastModelByProvider[providerId] !== model.id)
        void updateSettings({ lastModelByProvider: { ...settings.lastModelByProvider, [providerId]: model.id } });
    } catch (err) {
      toast.error(errorMessage(toGenerationError(err), providerId));
    }
  }

  return (
    <div className="space-y-4">
      {/* Taxonomy */}
      <div className="space-y-1.5">
        <Label htmlFor="category">{t("listing.category")}</Label>
        <Select<ListingCategoryId | "">
          id="category"
          value={selection?.categoryId ?? ""}
          placeholder={t("listing.chooseCategory")}
          options={LISTING_CATEGORIES.map((c) => ({
            value: c.id,
            label: c.label[locale],
            description: c.subcategories.map((s) => s.label[locale]).join(" · "),
          }))}
          onChange={(id) => {
            if (!id) return setListing(undefined);
            const first = LISTING_CATEGORIES.find((c) => c.id === id)?.subcategories[0];
            if (first) setListing({ categoryId: id, subcategoryId: first.id });
            setCustomPrompts({});
          }}
        />
      </div>
      {category && (
        <div className="space-y-1.5">
          <Label>{t("listing.subcategory")}</Label>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("listing.subcategory")}>
            {category.subcategories.map((s) => (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={selection?.subcategoryId === s.id}
                onClick={() => {
                  setListing({ categoryId: category.id, subcategoryId: s.id });
                  setCustomPrompts({});
                }}
                className={cn(
                  "inline-flex h-8 items-center rounded-md border px-2.5 text-xs font-medium transition-colors",
                  selection?.subcategoryId === s.id
                    ? "border-accent bg-accent-soft text-fg"
                    : "border-border text-fg-muted hover:border-border-strong hover:text-fg",
                )}
              >
                {s.label[locale]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Shot plan */}
      {shots.length > 0 && !customRecipe && (
        <div className="rounded-lg border border-border">
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-xs font-medium text-fg-muted">{t("listing.shots", { count: shots.length })}</span>
            <Switch checked={editShots} onChange={setEditShots} label={t("listing.editShots")} />
          </div>
          <ol className="divide-y divide-border border-t border-border">
            {shots.map((shot, i) => (
              <li key={shot.id} className="px-3 py-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="flex size-5 items-center justify-center rounded-full bg-bg-sunken text-[11px] font-semibold text-fg-muted">{i + 1}</span>
                  <span className="font-medium">{shot.label[locale]}</span>
                </div>
                {editShots && (
                  <Textarea
                    aria-label={shot.label[locale]}
                    rows={3}
                    value={customPrompts[shot.id] ?? shot.prompt}
                    onChange={(e) => setCustomPrompts({ ...customPrompts, [shot.id]: e.target.value })}
                    className="mt-1.5 text-xs"
                  />
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Custom recipe override (power users) */}
      {customRecipes.length > 0 && (
        <div className="space-y-1.5">
          <Label htmlFor="custom-recipe">{t("listing.customRecipe")}</Label>
          <Select
            id="custom-recipe"
            value={recipeId}
            options={[{ value: "", label: t("listing.customRecipeNone") }, ...customRecipes.map((r) => ({ value: r.id, label: r.name }))]}
            onChange={setRecipeId}
          />
        </div>
      )}

      {/* Output settings */}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1.5">
          <Label>{t("composer.aspectRatio")}</Label>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("composer.aspectRatio")}>
            {aspectOptions.map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={composer.aspectRatio === r}
                onClick={() => composer.setAspectRatio(r)}
                className={cn(
                  "inline-flex h-8 items-center rounded-md border px-2 text-xs font-medium transition-colors",
                  composer.aspectRatio === r ? "border-accent bg-accent-soft text-fg" : "border-border text-fg-muted hover:border-border-strong hover:text-fg",
                )}
              >
                {r === "original" ? t("composer.aspectOriginal") : r}
              </button>
            ))}
          </div>
        </div>
        {(providers.length > 1 || MOCK_ENABLED) && (
          <div className="space-y-1.5">
            <Label htmlFor="provider">{t("composer.provider")}</Label>
            <Select
              id="provider"
              value={providerId}
              options={providers.map((p) => ({ value: p.info.id, label: p.info.displayName }))}
              onChange={changeProvider}
            />
          </div>
        )}
        <div className={cn("space-y-1.5", providers.length > 1 || MOCK_ENABLED ? "" : "col-span-2")}>
          <Label htmlFor="model">{t("composer.model")}</Label>
          <Select
            id="model"
            value={composer.modelId ?? ""}
            options={models.map((m) => ({
              value: m.id,
              label: modelLabel(m),
              description: `${t(`composer.modelTier.${m.tier}` as MessageKey)}${!m.available ? ` · ${t("composer.modelUnavailable")}` : ""}`,
              disabled: !m.available,
            }))}
            onChange={(id) => composer.setModel(id)}
          />
        </div>
        {sizeOptions.length > 0 && (
          <div className="col-span-2 space-y-1.5">
            <Label>{t("composer.imageSize")}</Label>
            <Segmented
              ariaLabel={t("composer.imageSize")}
              size="sm"
              value={composer.imageSize ?? "default"}
              onChange={(v) => composer.setImageSize(v === "default" ? undefined : (v as ImageSize))}
              options={[{ value: "default", label: "Auto" }, ...sizeOptions.map((s) => ({ value: s, label: s }))]}
            />
          </div>
        )}
      </div>

      {optionSpecs.length > 0 && (
        <div className="rounded-lg border border-border">
          <button
            type="button"
            className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-fg-muted hover:text-fg"
            onClick={() => setAdvancedOpen((v) => !v)}
            aria-expanded={advancedOpen}
          >
            {t("composer.advanced")}
            <ChevronDown className={cn("size-3.5 transition-transform", advancedOpen && "rotate-180")} />
          </button>
          {advancedOpen && (
            <div className="space-y-3 border-t border-border p-3">
              {optionSpecs.map((spec) => {
                const value = providerOptions[spec.key] ?? spec.default;
                return (
                  <div key={spec.key} className="space-y-1">
                    <Label htmlFor={`opt-${spec.key}`} hint={spec.type === "number" ? String(value) : undefined}>
                      {t(spec.labelKey as MessageKey)}
                    </Label>
                    {spec.type === "number" ? (
                      <input
                        id={`opt-${spec.key}`}
                        type="range"
                        min={spec.min}
                        max={spec.max}
                        step={spec.step}
                        value={Number(value)}
                        onChange={(e) => composer.setProviderOption(providerId, spec.key, Number(e.target.value))}
                        className="w-full accent-[var(--accent)]"
                      />
                    ) : spec.type === "boolean" ? (
                      <Switch checked={Boolean(value)} onChange={(v) => composer.setProviderOption(providerId, spec.key, v)} />
                    ) : (
                      <Input
                        id={`opt-${spec.key}`}
                        value={String(value)}
                        onChange={(e) => composer.setProviderOption(providerId, spec.key, e.target.value)}
                        className="h-8"
                      />
                    )}
                    {spec.helpKey && <p className="text-[11px] text-fg-subtle">{t(spec.helpKey as MessageKey)}</p>}
                  </div>
                );
              })}
              <Button variant="ghost" size="sm" onClick={() => composer.resetProviderOptions(providerId)}>
                {t("composer.resetAdvanced")}
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Action */}
      <div className="space-y-2">
        {activeGeneration ? (
          <div className="flex items-center gap-2">
            <div className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-border bg-bg-elevated px-3">
              <span className="size-2 shrink-0 animate-pulse rounded-full bg-accent" />
              <span className="truncate text-sm">{t("composer.generating", { done: activeDone, total: activeGeneration.jobIds.length })}</span>
              <div className="ml-auto h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-bg-sunken">
                <div className="h-full bg-accent transition-[width]" style={{ width: `${(activeDone / activeGeneration.jobIds.length) * 100}%` }} />
              </div>
            </div>
            <Button variant="danger" size="lg" leftIcon={<Square className="size-4" />} onClick={cancelAll} aria-label={t("generation.cancelAll")}>
              {t("common.cancel")}
            </Button>
          </div>
        ) : (
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={!ready}
            onClick={() => void generate()}
            leftIcon={<WandSparkles className="size-4" />}
          >
            {customRecipe ? t("composer.generateCount", { count: 4 }) : t("listing.generatePack", { count: effectiveShots.length })}
          </Button>
        )}
        <div className="text-xs text-fg-subtle">
          {blocker === "composer.needAuth" ? (
            <button
              type="button"
              className="inline-flex items-center gap-1 text-accent hover:underline"
              onClick={() => navigate({ name: "settings", section: "providers" })}
            >
              <Sparkles className="size-3" /> {t(blocker)}
            </button>
          ) : blocker ? (
            <span>{t(blocker)}</span>
          ) : (
            <span>{t("listing.packHint")}</span>
          )}
        </div>
      </div>

      <UsageMeter providerId={providerId} modelId={composer.modelId} />
    </div>
  );
}
