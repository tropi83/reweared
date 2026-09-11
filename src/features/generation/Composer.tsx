import { useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, History, Sparkles, Square, WandSparkles } from "lucide-react";
import { navigate } from "@/app/router";
import { useAuthStore } from "@/app/stores/auth-store";
import { useComposerStore } from "@/app/stores/composer-store";
import { useGenerationStore } from "@/app/stores/generation-store";
import { useProjectsStore } from "@/app/stores/projects-store";
import { useRecipesStore } from "@/app/stores/recipes-store";
import { useSettingsStore } from "@/app/stores/settings-store";
import { toast } from "@/app/stores/toast-store";
import { getServices, MOCK_ENABLED } from "@/app/services";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select, Textarea } from "@/components/ui/Input";
import { Kbd, Segmented } from "@/components/ui/Misc";
import { ALL_ASPECT_RATIOS, toGenerationError, type AspectRatio, type ImageSize, type ModelInfo } from "@/domain/models";
import { BUILT_IN_RECIPES, extractVariables, interpolate } from "@/domain/services/recipes";
import { MOCK_PROVIDER_ID } from "@/infrastructure/providers/mock/MockImageProvider";
import { useT, type MessageKey } from "@/i18n";
import { cn } from "@/lib/cn";
import { RecipePicker } from "../recipes/RecipePicker";
import { UsageMeter } from "./UsageMeter";

const COUNT_OPTIONS = [1, 2, 4, 6, 8];

export function Composer() {
  const t = useT();
  const doc = useProjectsStore((s) => s.current);
  const composer = useComposerStore();
  const settings = useSettingsStore((s) => s.settings);
  const updateSettings = useSettingsStore((s) => s.update);
  const authStatus = useAuthStore((s) => s.status);
  const modelsByProvider = useGenerationStore((s) => s.modelsByProvider);
  const loadModels = useGenerationStore((s) => s.loadModels);
  const start = useGenerationStore((s) => s.start);
  const cancelAll = useGenerationStore((s) => s.cancelAll);
  const customRecipes = useRecipesStore((s) => s.custom);
  const recipes = useMemo(() => [...BUILT_IN_RECIPES, ...customRecipes], [customRecipes]);
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const providerId = composer.providerId;
  const providers = [...getServices().providers.values()];
  const models = useMemo(() => modelsByProvider[providerId] ?? [], [modelsByProvider, providerId]);
  const isMock = providerId === MOCK_PROVIDER_ID;

  // Load models when the provider or the credential changes.
  useEffect(() => {
    void loadModels(providerId, true);
  }, [providerId, authStatus.state, authStatus.projectId, loadModels]);

  // Keep a valid model selected.
  useEffect(() => {
    if (models.length === 0) return;
    const preferred = composer.modelId ?? settings.lastModelByProvider[providerId];
    const valid = models.find((m) => m.id === preferred && m.available) ?? models.find((m) => m.available) ?? models[0];
    if (valid && valid.id !== composer.modelId) composer.setModel(valid.id);
  }, [models, composer, providerId, settings.lastModelByProvider]);

  // Seed the composer from the saved defaults once per mount.
  useEffect(() => {
    composer.setVariationCount(settings.defaultVariationCount);
    composer.setAspectRatio(settings.defaultAspectRatio);
    if (settings.defaultImageSize) composer.setImageSize(settings.defaultImageSize);
    if (getServices().providers.has(settings.activeProviderId)) composer.setProvider(settings.activeProviderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeProvider = (id: string) => {
    composer.setProvider(id);
    void updateSettings({ activeProviderId: id });
  };

  const model: ModelInfo | undefined = models.find((m) => m.id === composer.modelId);
  const aspectOptions = useMemo<AspectRatio[]>(
    () => ALL_ASPECT_RATIOS.filter((r) => r === "original" || model?.capabilities.supportedAspectRatios.includes(r)),
    [model],
  );
  const sizeOptions = useMemo(() => model?.capabilities.supportedImageSizes ?? [], [model]);

  // Snap unsupported selections when the model changes.
  useEffect(() => {
    if (!model) return;
    if (!aspectOptions.includes(composer.aspectRatio)) composer.setAspectRatio("original");
    if (composer.imageSize && !sizeOptions.includes(composer.imageSize)) composer.setImageSize(undefined);
  }, [model, aspectOptions, sizeOptions, composer]);

  const variables = useMemo(() => extractVariables(composer.prompt), [composer.prompt]);
  const finalPrompt = useMemo(() => interpolate(composer.prompt, composer.recipeValues), [composer.prompt, composer.recipeValues]);

  const activeJobs = doc ? Object.values(doc.jobs).filter((j) => j.status === "queued" || j.status === "generating") : [];
  const activeGeneration = activeJobs.length > 0 && doc ? doc.generations[activeJobs[0]!.generationId] : undefined;
  const activeDone = activeGeneration ? activeGeneration.jobIds.filter((id) => doc?.jobs[id]?.status === "completed").length : 0;

  const authOk = isMock || authStatus.state === "authenticated";
  const sourceId = composer.sourceImageId ?? doc?.project.originalImageId;
  const canGenerate = !!doc && !!sourceId && !!model?.available && finalPrompt.trim().length > 0 && authOk;
  const blocker: MessageKey | null = !doc?.project.originalImageId
    ? "composer.needImage"
    : !authOk
      ? "composer.needAuth"
      : finalPrompt.trim().length === 0
        ? "composer.needPrompt"
        : null;

  const promptHistory = useMemo(() => {
    if (!doc) return [];
    const seen = new Set<string>();
    return Object.values(doc.generations)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((g) => g.prompt)
      .filter((p) => (seen.has(p) ? false : (seen.add(p), true)))
      .slice(0, 12);
  }, [doc]);

  async function generate() {
    if (!canGenerate || !doc || !sourceId || !model) return;
    try {
      await start({
        sourceImageId: sourceId,
        prompt: finalPrompt,
        providerId,
        modelId: model.id,
        aspectRatio: composer.aspectRatio,
        ...(composer.imageSize ? { imageSize: composer.imageSize } : {}),
        variationCount: composer.variationCount,
        ...(composer.recipeId ? { recipeId: composer.recipeId } : {}),
      });
      if (settings.lastModelByProvider[providerId] !== model.id) {
        void updateSettings({ lastModelByProvider: { ...settings.lastModelByProvider, [providerId]: model.id } });
      }
    } catch (err) {
      const error = toGenerationError(err);
      toast.error(t(`error.${error.code}` as MessageKey));
    }
  }

  function autoGrow() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(280, Math.max(96, el.scrollHeight))}px`;
  }
  useEffect(autoGrow, [composer.prompt]);

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="prompt">{t("composer.promptLabel")}</Label>
          <div className="flex items-center gap-1">
            {promptHistory.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<History className="size-3.5" />}
                onClick={() => setHistoryOpen((v) => !v)}
                aria-expanded={historyOpen}
              >
                {t("composer.promptHistory")}
              </Button>
            )}
            <Button variant="ghost" size="sm" leftIcon={<BookOpen className="size-3.5" />} onClick={() => setRecipeOpen(true)}>
              {t("composer.recipes")}
            </Button>
          </div>
        </div>
        {historyOpen && (
          <ul className="fade-in max-h-40 overflow-y-auto rounded-lg border border-border bg-bg-elevated p-1 text-sm">
            {promptHistory.map((p) => (
              <li key={p}>
                <button
                  type="button"
                  className="w-full truncate rounded-md px-2 py-1.5 text-left hover:bg-bg-sunken"
                  title={p}
                  onClick={() => {
                    composer.setPrompt(p);
                    setHistoryOpen(false);
                  }}
                >
                  {p}
                </button>
              </li>
            ))}
          </ul>
        )}
        <Textarea
          id="prompt"
          ref={textareaRef}
          value={composer.prompt}
          onChange={(e) => composer.setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              void generate();
            }
          }}
          placeholder={t("composer.promptPlaceholder")}
          rows={4}
          className="min-h-24 text-[15px]"
        />
        {variables.length > 0 && (
          <div className="fade-in space-y-2 rounded-lg border border-border bg-bg-sunken p-2.5">
            <div className="text-[11px] font-medium tracking-wider text-fg-subtle uppercase">{t("composer.recipeVariables")}</div>
            {variables.map((name) => (
              <div key={name} className="flex items-center gap-2">
                <Label htmlFor={`var-${name}`} className="w-28 shrink-0 truncate">
                  {name}
                </Label>
                <Input
                  id={`var-${name}`}
                  value={composer.recipeValues[name] ?? ""}
                  onChange={(e) => composer.setRecipeValue(name, e.target.value)}
                  className="h-8"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2 space-y-1.5">
          <Label>{t("composer.variations")}</Label>
          <Segmented
            ariaLabel={t("composer.variations")}
            value={String(composer.variationCount)}
            onChange={(v) => composer.setVariationCount(Number(v))}
            options={COUNT_OPTIONS.map((n) => ({ value: String(n), label: n }))}
            className="w-full justify-between"
          />
        </div>

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
                  "inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors",
                  composer.aspectRatio === r ? "border-accent bg-accent-soft text-fg" : "border-border text-fg-muted hover:border-border-strong hover:text-fg",
                )}
              >
                <RatioIcon ratio={r} />
                {r === "original" ? t("composer.aspectOriginal") : r}
              </button>
            ))}
          </div>
        </div>

        {(providers.length > 1 || MOCK_ENABLED) && (
          <div className="space-y-1.5">
            <Label htmlFor="provider">{t("composer.provider")}</Label>
            <Select id="provider" value={providerId} onChange={(e) => changeProvider(e.target.value)}>
              {providers.map((p) => (
                <option key={p.info.id} value={p.info.id}>
                  {p.info.displayName}
                </option>
              ))}
            </Select>
          </div>
        )}

        <div className={cn("space-y-1.5", providers.length > 1 || MOCK_ENABLED ? "" : "col-span-2")}>
          <Label htmlFor="model">{t("composer.model")}</Label>
          <Select id="model" value={composer.modelId ?? ""} onChange={(e) => composer.setModel(e.target.value)}>
            {models.map((m) => (
              <option key={m.id} value={m.id} disabled={!m.available}>
                {t(`composer.modelTier.${m.tier}` as MessageKey)} · {m.id}
                {!m.available ? ` (${t("composer.modelUnavailable")})` : ""}
              </option>
            ))}
          </Select>
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
            disabled={!canGenerate}
            onClick={() => void generate()}
            leftIcon={<WandSparkles className="size-4" />}
          >
            {t("composer.generateCount", { count: composer.variationCount })}
          </Button>
        )}
        <div className="flex items-center justify-between text-xs text-fg-subtle">
          {blocker ? (
            blocker === "composer.needAuth" ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-accent hover:underline"
                onClick={() => navigate({ name: "settings", section: "providers" })}
              >
                <Sparkles className="size-3" /> {t(blocker)}
              </button>
            ) : (
              <span>{t(blocker)}</span>
            )
          ) : (
            <span className="inline-flex items-center gap-1">
              <Kbd>Ctrl</Kbd>+<Kbd>↵</Kbd> {t("composer.generate")}
            </span>
          )}
        </div>
      </div>

      <UsageMeter providerId={providerId} modelId={composer.modelId} />

      <RecipePicker
        open={recipeOpen}
        onClose={() => setRecipeOpen(false)}
        recipes={recipes}
        onPick={(recipe) => {
          composer.setPrompt(recipe.promptTemplate);
          composer.setRecipe(recipe.id, {});
          setRecipeOpen(false);
          textareaRef.current?.focus();
        }}
      />
    </div>
  );
}

function RatioIcon({ ratio }: { ratio: AspectRatio }) {
  if (ratio === "original") return <span className="inline-block size-3 rounded-[2px] border border-dashed border-current" aria-hidden />;
  const [w, h] = ratio.split(":").map(Number) as [number, number];
  const scale = 12 / Math.max(w, h);
  return (
    <span className="inline-block rounded-[2px] border border-current" style={{ width: Math.max(4, w * scale), height: Math.max(4, h * scale) }} aria-hidden />
  );
}
