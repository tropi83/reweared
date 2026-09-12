import { useState } from "react";
import { Settings2 } from "lucide-react";
import { navigate } from "@/app/router";
import { useRecipesStore } from "@/app/stores/recipes-store";
import { Button } from "@/components/ui/Button";
import { Input, Label, Switch, Textarea } from "@/components/ui/Input";
import { Segmented } from "@/components/ui/Misc";
import { Select } from "@/components/ui/Select";
import type { ImageSize, ShotSpec } from "@/domain/models";
import { useLocale, useT, type MessageKey } from "@/i18n";
import { cn } from "@/lib/cn";
import { modelLabel } from "../settings/ModelsSection";
import { useComposerModels } from "./useComposerDefaults";

/** Per-run options behind "Advanced options" of the listing card: shot prompts, custom recipe, format, model options. The provider and model live in Settings → Models. */
export function AdvancedOptions({
  shots,
  promptOverrides,
  onPromptOverridesChange,
  customRecipeId,
  onCustomRecipeChange,
}: {
  shots: ShotSpec[];
  promptOverrides: Record<string, string>;
  onPromptOverridesChange: (v: Record<string, string>) => void;
  customRecipeId: string;
  onCustomRecipeChange: (id: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const { composer, providers, model, aspectOptions, sizeOptions } = useComposerModels();
  const customRecipes = useRecipesStore((s) => s.custom);
  const [editShots, setEditShots] = useState(false);
  const providerId = composer.providerId;
  const optionSpecs = model?.capabilities.options ?? [];
  const providerOptions = composer.providerOptions[providerId] ?? {};
  const customRecipe = customRecipes.find((r) => r.id === customRecipeId);
  const providerName = providers.find((p) => p.info.id === providerId)?.info.displayName ?? providerId;

  return (
    <div className="space-y-4">
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
                    value={promptOverrides[shot.id] ?? shot.prompt}
                    onChange={(e) => onPromptOverridesChange({ ...promptOverrides, [shot.id]: e.target.value })}
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
            value={customRecipeId}
            options={[{ value: "", label: t("listing.customRecipeNone") }, ...customRecipes.map((r) => ({ value: r.id, label: r.name }))]}
            onChange={onCustomRecipeChange}
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
        <div className="col-span-2 flex items-center justify-between gap-2 text-xs text-fg-muted">
          <span className="truncate">
            {t("composer.model")}: {providerName}
            {model ? ` · ${modelLabel(model)}` : ""}
          </span>
          <Button variant="ghost" size="sm" leftIcon={<Settings2 className="size-3.5" />} onClick={() => navigate({ name: "settings", section: "models" })}>
            {t("models.change")}
          </Button>
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

      {/* Provider options (seed, steps…) declared by the model's capabilities */}
      {optionSpecs.length > 0 && (
        <div className="space-y-3 rounded-lg border border-border p-3">
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
  );
}
