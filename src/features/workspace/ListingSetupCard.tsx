import { useState, type ReactNode } from "react";
import { Sparkles, Square, UserRound, WandSparkles } from "lucide-react";
import { listingReadiness, type ListingReadiness } from "@/app/listing-readiness";
import { listingRunCost, useCredits, usePlatform } from "@/app/query/credits";
import { navigate } from "@/app/router";
import { BRAND_MAX_LENGTH, useListingSetupStore, type ListingRunReport } from "@/app/stores/listing-setup-store";
import { useListingsStore } from "@/app/stores/listings-store";
import { useSettingsStore } from "@/app/stores/settings-store";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Input, Label, Switch } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import type { CategoryId } from "@aiv/domain/models";
import { buildShots, CATEGORIES } from "@aiv/domain/services/catalog";
import { mannequinApplies, normalizeMannequin } from "@aiv/domain/services/mannequin";
import { CATEGORY_ICONS, SUBCATEGORY_ICONS } from "../catalog/category-icons";
import { useLocale, useT } from "@/i18n";
import { errorMessage } from "@/i18n/errors";
import { cn } from "@/lib/cn";
import { MannequinDialog, MannequinSummary } from "../mannequin/MannequinDialog";

/** The listing setup: brand, taxonomy, mannequin and the single "Create the listing" button. */
export function ListingSetupCard() {
  const t = useT();
  const locale = useLocale();
  const doc = useListingsStore((s) => s.current);
  const creating = useListingSetupStore((s) => s.creating);
  const copyBusy = useListingSetupStore((s) => s.copyBusy);
  const lastRun = useListingSetupStore((s) => (s.lastRunListingId === doc?.listing.id ? s.lastRun : null));
  const settings = useSettingsStore((s) => s.settings);
  const { credits } = useCredits();
  const platform = usePlatform();
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
  const photoCount = shots.length;
  // What the run costs at the platform's prices, checked against the balance before the server does.
  const cost = platform && selection ? listingRunCost(platform, photoCount) : undefined;
  const readiness = listingReadiness({
    hasImage: true,
    hasSelection: !!selection,
    ...(cost !== undefined && credits ? { credits: { balance: credits.balance, cost } } : {}),
  });
  const alreadyCreated = !!doc.listing.copy || Object.keys(doc.generations).length > 0;
  const activeJobs = Object.values(doc.jobs).filter((j) => j.status === "queued" || j.status === "generating");
  const activeGeneration = activeJobs[0] ? doc.generations[activeJobs[0].generationId] : undefined;
  const activeDone = activeGeneration ? activeGeneration.jobIds.filter((id) => doc.jobs[id]?.status === "completed").length : 0;
  const running = creating || copyBusy || activeJobs.length > 0;
  // The label says what will run and what it costs; a blocked button promises nothing.
  const action =
    !selection || readiness.blocker ? t("listing.createPlain") : alreadyCreated ? t("listing.recreate") : t("listing.create", { count: photoCount });
  const label = cost !== undefined && !readiness.blocker ? `${action} · ${t("credits.cost", { count: cost })}` : action;

  const run = () => void generateListing();

  const toggleMannequin = (on: boolean) => {
    if (on && !mannequin) {
      setEnableAfterSave(true);
      setMannequinOpen(true);
    } else setUseMannequin(on);
  };

  return (
    <section className="space-y-4" aria-label={t("listing.title")}>
      <div className="space-y-1.5">
        <Label htmlFor="category">{t("listing.category")}</Label>
        <Select<CategoryId | "">
          id="category"
          value={selection?.categoryId ?? ""}
          placeholder={t("listing.chooseCategory")}
          options={CATEGORIES.map((c) => {
            const Icon = CATEGORY_ICONS[c.id];
            return {
              value: c.id,
              label: (
                <span className="inline-flex items-center gap-2">
                  <Icon className="size-4 shrink-0 text-fg-muted" aria-hidden /> {c.label[locale]}
                </span>
              ),
              description: c.subcategories.map((s) => s.label[locale]).join(" · "),
            };
          })}
          onChange={(id) => {
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
            {category.subcategories.map((s) => {
              const Icon = SUBCATEGORY_ICONS[`${category.id}/${s.id}`] ?? CATEGORY_ICONS[category.id];
              return (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={selection?.subcategoryId === s.id}
                  onClick={() => {
                    setCategory({ categoryId: category.id, subcategoryId: s.id });
                  }}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors",
                    selection?.subcategoryId === s.id
                      ? "border-accent bg-accent-soft text-fg"
                      : "border-border text-fg-muted hover:border-border-strong hover:text-fg",
                  )}
                >
                  <Icon className="size-3.5 shrink-0" aria-hidden />
                  {s.label[locale]}
                </button>
              );
            })}
          </div>
        </div>
      )}

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
        <ListingHints readiness={readiness} lastRun={lastRun} />
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

/** One line per blocker or start failure, under the button. Text errors live in the copy panel. */
function ListingHints({ readiness, lastRun }: { readiness: ListingReadiness; lastRun: ListingRunReport | null }) {
  const t = useT();
  const toCredits = (
    <button
      type="button"
      className="inline-flex items-center gap-1 text-left text-accent hover:underline"
      onClick={() => navigate({ name: "settings", section: "credits" })}
    >
      <Sparkles className="size-3 shrink-0" /> {t("listing.needCredits")}
    </button>
  );
  const lines: ReactNode[] = [];
  if (readiness.blocker === "listing.needCredits") lines.push(toCredits);
  else if (readiness.blocker) lines.push(t(readiness.blocker));
  else lines.push(t("listing.packHint"));
  // Run errors read as the platform's (credits, daily limit), not as a provider account's.
  if (lastRun && typeof lastRun.photos === "object") lines.push(<span className="text-danger">{errorMessage(lastRun.photos.error, "platform")}</span>);
  return (
    <div className="space-y-0.5 text-xs text-fg-subtle">
      {lines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  );
}
