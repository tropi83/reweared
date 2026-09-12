import { useState, type ReactNode } from "react";
import { ChevronDown, Sparkles, Square, UserRound, WandSparkles } from "lucide-react";
import { listingReadiness, type ListingReadiness } from "@/app/listing-readiness";
import { navigate } from "@/app/router";
import { getServices } from "@/app/services";
import { useAuthStore } from "@/app/stores/auth-store";
import { useComposerStore } from "@/app/stores/composer-store";
import { useGenerationStore } from "@/app/stores/generation-store";
import { BRAND_MAX_LENGTH, photoPartReady, textPartReady, useListingSetupStore, type ListingRunReport } from "@/app/stores/listing-setup-store";
import { useListingsStore } from "@/app/stores/listings-store";
import { useRecipesStore } from "@/app/stores/recipes-store";
import { useSettingsStore } from "@/app/stores/settings-store";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Input, Label, Switch } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { CategoryId } from "@/domain/models";
import { buildShots, CATEGORIES } from "@/domain/services/catalog";
import { mannequinApplies, normalizeMannequin } from "@/domain/services/mannequin";
import { interpolate } from "@/domain/services/recipes";
import { useLocale, useT } from "@/i18n";
import { errorMessage } from "@/i18n/errors";
import { cn } from "@/lib/cn";
import { MannequinDialog, MannequinSummary } from "../mannequin/MannequinDialog";
import { AdvancedOptions } from "./AdvancedOptions";
import { useComposerDefaults } from "./useComposerDefaults";

/** The listing setup: brand, taxonomy, mannequin, advanced options and the single "Create the listing" button. */
export function ListingSetupCard() {
  const t = useT();
  const locale = useLocale();
  const doc = useListingsStore((s) => s.current);
  const creating = useListingSetupStore((s) => s.creating);
  const copyBusy = useListingSetupStore((s) => s.copyBusy);
  const lastRun = useListingSetupStore((s) => (s.lastRunListingId === doc?.listing.id ? s.lastRun : null));
  const settings = useSettingsStore((s) => s.settings);
  const composerProviderId = useComposerStore((s) => s.providerId);
  // Subscriptions that change readiness (photoPartReady/textPartReady read these stores).
  useAuthStore((s) => s.providerStatus);
  useGenerationStore((s) => s.modelsByProvider);
  useComposerStore((s) => s.modelId);
  const customRecipes = useRecipesStore((s) => s.custom);
  useComposerDefaults();
  const [promptOverrides, setPromptOverrides] = useState<Record<string, string>>({});
  const [customRecipeId, setCustomRecipeId] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [mannequinOpen, setMannequinOpen] = useState(false);
  const [enableAfterSave, setEnableAfterSave] = useState(false);
  const [confirmRecreate, setConfirmRecreate] = useState(false);

  if (!doc?.listing.originalImageId) return null;
  const { setCategory, setBrand, setUseMannequin, generateListing, cancelListingRun } = useListingSetupStore.getState();
  const selection = doc.listing.category;
  const category = CATEGORIES.find((c) => c.id === selection?.categoryId);
  const mannequin = normalizeMannequin(settings.mannequin);
  const applies = !selection || mannequinApplies(selection.categoryId);
  const mannequinOn = !!doc.listing.useMannequin && applies && !!mannequin;
  const shots = selection ? buildShots(selection, mannequinOn && mannequin ? { mannequin } : {}) : [];
  const customRecipe = customRecipes.find((r) => r.id === customRecipeId);
  const readiness = listingReadiness({ hasImage: true, hasSelection: !!selection, photosReady: photoPartReady(), textReady: textPartReady() });
  const alreadyCreated = !!doc.listing.copy || Object.keys(doc.generations).length > 0;
  const activeJobs = Object.values(doc.jobs).filter((j) => j.status === "queued" || j.status === "generating");
  const activeGeneration = activeJobs[0] ? doc.generations[activeJobs[0].generationId] : undefined;
  const activeDone = activeGeneration ? activeGeneration.jobIds.filter((id) => doc.jobs[id]?.status === "completed").length : 0;
  const running = creating || copyBusy || activeJobs.length > 0;
  const photoCount = customRecipe ? 4 : shots.length;
  // The label says what will actually run: a part whose provider is not usable is skipped; a blocked button promises nothing.
  const label =
    !selection || readiness.blocker
      ? t("listing.createPlain")
      : alreadyCreated
        ? t("listing.recreate")
        : readiness.skipped.includes("text")
          ? t("listing.createPhotos", { count: photoCount })
          : readiness.skipped.includes("photos")
            ? t("listing.createText")
            : t("listing.create", { count: photoCount });

  const run = () =>
    void generateListing({
      promptOverrides,
      ...(customRecipe ? { customRecipe: { id: customRecipe.id, prompt: interpolate(customRecipe.promptTemplate, {}) } } : {}),
    });

  const toggleMannequin = (on: boolean) => {
    if (on && !mannequin) {
      setEnableAfterSave(true);
      setMannequinOpen(true);
    } else setUseMannequin(on);
  };

  return (
    <section className="space-y-4" aria-label={t("listing.title")}>
      <div className="space-y-1.5">
        <Label htmlFor="listing-brand" hint={t("listing.brandHint")}>
          {t("listing.brand")}
        </Label>
        <Input
          id="listing-brand"
          value={doc.listing.brand ?? ""}
          maxLength={BRAND_MAX_LENGTH}
          placeholder={t("listing.brandPlaceholder")}
          autoComplete="off"
          onChange={(e) => setBrand(e.target.value)}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="category">{t("listing.category")}</Label>
        <Select<CategoryId | "">
          id="category"
          value={selection?.categoryId ?? ""}
          placeholder={t("listing.chooseCategory")}
          options={CATEGORIES.map((c) => ({
            value: c.id,
            label: c.label[locale],
            description: c.subcategories.map((s) => s.label[locale]).join(" · "),
          }))}
          onChange={(id) => {
            setPromptOverrides({});
            if (!id) return setCategory(undefined);
            const first = CATEGORIES.find((c) => c.id === id)?.subcategories[0];
            if (first) setCategory({ categoryId: id, subcategoryId: first.id });
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
                  setPromptOverrides({});
                  setCategory({ categoryId: category.id, subcategoryId: s.id });
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

      <div className="rounded-lg border border-border p-3">
        <div className="flex items-center justify-between gap-2">
          <Switch checked={mannequinOn} disabled={!applies} onChange={toggleMannequin} label={t("mannequin.toggle")} />
          {mannequin && applies && (
            <Button variant="ghost" size="sm" leftIcon={<UserRound className="size-3.5" />} onClick={() => setMannequinOpen(true)}>
              {t("mannequin.edit")}
            </Button>
          )}
        </div>
        <div className="mt-1 text-[11px] text-fg-subtle">
          {!applies ? t("mannequin.notForCategory") : mannequin ? <MannequinSummary mannequin={mannequin} /> : t("mannequin.toggleHint")}
        </div>
      </div>
      <MannequinDialog
        open={mannequinOpen}
        onClose={() => {
          setMannequinOpen(false);
          setEnableAfterSave(false);
        }}
        onSaved={() => {
          if (enableAfterSave) setUseMannequin(true);
        }}
      />

      <div className="rounded-lg border border-border">
        <button
          type="button"
          className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-fg-muted hover:text-fg"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((v) => !v)}
        >
          {t("listing.advanced")}
          <ChevronDown className={cn("size-3.5 transition-transform", advancedOpen && "rotate-180")} />
        </button>
        {advancedOpen && (
          <div className="border-t border-border p-3">
            <AdvancedOptions
              shots={shots}
              promptOverrides={promptOverrides}
              onPromptOverridesChange={setPromptOverrides}
              customRecipeId={customRecipeId}
              onCustomRecipeChange={setCustomRecipeId}
            />
          </div>
        )}
      </div>

      <div className="space-y-2">
        {running ? (
          <div className="flex items-center gap-2">
            <div className="flex h-11 min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-border bg-bg-elevated px-3">
              <span className="size-2 shrink-0 animate-pulse rounded-full bg-accent" />
              <span className="truncate text-sm">
                {activeGeneration ? t("composer.generating", { done: activeDone, total: activeGeneration.jobIds.length }) : t("listing.creating")}
              </span>
              {activeGeneration && (
                <div className="ml-auto h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-bg-sunken">
                  <div className="h-full bg-accent transition-[width]" style={{ width: `${(activeDone / activeGeneration.jobIds.length) * 100}%` }} />
                </div>
              )}
            </div>
            <Button variant="danger" size="lg" leftIcon={<Square className="size-4" />} onClick={cancelListingRun} aria-label={t("generation.cancelAll")}>
              {t("common.cancel")}
            </Button>
          </div>
        ) : (
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={!readiness.canCreate}
            leftIcon={<WandSparkles className="size-4" />}
            onClick={() => (alreadyCreated ? setConfirmRecreate(true) : run())}
          >
            {label}
          </Button>
        )}
        <ListingHints readiness={readiness} lastRun={lastRun} providerId={composerProviderId} copyProviderId={settings.copyProviderId} />
      </div>
      <ConfirmDialog
        open={confirmRecreate}
        onClose={() => setConfirmRecreate(false)}
        onConfirm={() => {
          setConfirmRecreate(false);
          run();
        }}
        title={t("listing.recreate.title")}
        body={t("listing.recreate.body")}
        confirmLabel={t("listing.recreate")}
      />
    </section>
  );
}

/** One line per blocker / skipped part / start failure, under the button. Text errors live in the copy panel. */
function ListingHints({
  readiness,
  lastRun,
  providerId,
  copyProviderId,
}: {
  readiness: ListingReadiness;
  lastRun: ListingRunReport | null;
  providerId: string;
  copyProviderId: string;
}) {
  const t = useT();
  const toSettings = () => navigate({ name: "settings", section: "providers" });
  const link = (text: string) => (
    <button type="button" className="inline-flex items-center gap-1 text-left text-accent hover:underline" onClick={toSettings}>
      <Sparkles className="size-3 shrink-0" /> {text}
    </button>
  );
  const lines: ReactNode[] = [];
  if (readiness.blocker) lines.push(readiness.blocker === "listing.needProviders" ? link(t(readiness.blocker)) : t(readiness.blocker));
  else {
    if (readiness.skipped.includes("photos")) lines.push(link(t("listing.skipPhotos")));
    if (readiness.skipped.includes("text"))
      lines.push(link(t("listing.skipText", { provider: getServices().copyProviders.get(copyProviderId)?.displayName ?? copyProviderId })));
    if (lines.length === 0) lines.push(t("listing.packHint"));
  }
  if (lastRun && typeof lastRun.photos === "object") lines.push(<span className="text-danger">{errorMessage(lastRun.photos.error, providerId)}</span>);
  return (
    <div className="space-y-0.5 text-xs text-fg-subtle">
      {lines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  );
}
