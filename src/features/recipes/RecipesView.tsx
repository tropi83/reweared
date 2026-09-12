import { useState } from "react";
import { Copy, Menu, Pencil, Plus, Trash2 } from "lucide-react";
import { useRecipesStore } from "@/app/stores/recipes-store";
import { useUiStore } from "@/app/stores/ui-store";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog, Dialog } from "@/components/ui/Dialog";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Misc";
import { RECIPE_CATEGORIES, type Recipe, type RecipeCategory } from "@/domain/models";
import { BUILT_IN_RECIPES, extractVariables } from "@/domain/services/recipes";
import { useLocale, useT, type MessageKey } from "@/i18n";
import { findSubcategory } from "@/domain/services/catalog";
import { CategoryIcon } from "../catalog/category-icons";

type Draft = { id?: string; name: string; description: string; promptTemplate: string; category: RecipeCategory };

const EMPTY: Draft = { name: "", description: "", promptTemplate: "", category: "custom" };

export function RecipesView() {
  const t = useT();
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const custom = useRecipesStore((s) => s.custom);
  const { save, remove, duplicate } = useRecipesStore.getState();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<Recipe | null>(null);
  const builtIn = BUILT_IN_RECIPES;

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3 md:px-5">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setSidebarOpen(true)} aria-label={t("nav.listings")}>
          <Menu className="size-5" />
        </Button>
        <h1 className="text-base font-semibold">{t("recipes.title")}</h1>
        <Button variant="primary" size="sm" className="ml-auto" leftIcon={<Plus className="size-4" />} onClick={() => setDraft(EMPTY)}>
          {t("recipes.new")}
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-8 p-4 md:p-6">
          <p className="text-sm text-fg-muted">{t("recipes.subtitle")}</p>
          <RecipeGroup
            title={t("recipes.custom")}
            recipes={custom}
            empty={t("recipes.empty")}
            onEdit={(r) => setDraft({ id: r.id, name: r.name, description: r.description ?? "", promptTemplate: r.promptTemplate, category: r.category })}
            onDuplicate={(r) => void duplicate(r.id)}
            onDelete={(r) => setDeleting(r)}
          />
          <RecipeGroup title={t("recipes.builtIn")} recipes={builtIn} onDuplicate={(r) => void duplicate(r.id)} />
        </div>
      </div>

      <Dialog
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? t("common.edit") : t("recipes.new")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={!draft || !draft.name.trim() || !draft.promptTemplate.trim()}
              onClick={async () => {
                if (!draft) return;
                await save(draft);
                setDraft(null);
              }}
            >
              {t("common.save")}
            </Button>
          </>
        }
      >
        {draft && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="rname">{t("common.name")}</Label>
              <Input id="rname" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rdesc">{t("common.description")}</Label>
              <Input id="rdesc" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rcat">{t("common.category")}</Label>
              <Select<RecipeCategory>
                id="rcat"
                value={draft.category}
                options={RECIPE_CATEGORIES.map((c) => ({ value: c, label: t(`recipes.category.${c}` as MessageKey) }))}
                onChange={(category) => setDraft({ ...draft, category })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rtpl">{t("recipes.template")}</Label>
              <Textarea id="rtpl" rows={6} value={draft.promptTemplate} onChange={(e) => setDraft({ ...draft, promptTemplate: e.target.value })} />
              {extractVariables(draft.promptTemplate).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {extractVariables(draft.promptTemplate).map((v) => (
                    <Badge key={v} tone="accent">
                      {`{{${v}}}`}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={t("recipes.delete.title")}
        body={deleting?.name}
        confirmLabel={t("common.delete")}
        danger
        onConfirm={async () => {
          if (deleting) await remove(deleting.id);
          setDeleting(null);
        }}
      />
    </div>
  );
}

function RecipeGroup({
  title,
  recipes,
  empty,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  title: string;
  recipes: Recipe[];
  empty?: string;
  onEdit?: (r: Recipe) => void;
  onDuplicate: (r: Recipe) => void;
  onDelete?: (r: Recipe) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const displayName = (r: Recipe) => {
    const found = r.pack ? findSubcategory(r.pack) : undefined;
    if (!found || !r.pack) return r.name;
    return (
      <span className="inline-flex items-center gap-1.5">
        <CategoryIcon selection={r.pack} className="size-4 shrink-0 text-fg-muted" aria-hidden />
        {found.category.label[locale]} › {found.subcategory.label[locale]}
      </span>
    );
  };
  const displayDescription = (r: Recipe) => (r.shots ? r.shots.map((s) => s.label[locale]).join(" · ") : r.description);
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold tracking-wider text-fg-subtle uppercase">{title}</h2>
      {recipes.length === 0 && empty && <p className="text-sm text-fg-subtle">{empty}</p>}
      <ul className="grid gap-3 sm:grid-cols-2">
        {recipes.map((r) => (
          <li key={r.id} className="group flex flex-col gap-2 rounded-xl border border-border bg-bg-elevated p-3">
            <div className="flex items-center gap-2">
              <span className="font-medium">{displayName(r)}</span>
              <Badge className="ml-auto">{t(`recipes.category.${r.category}` as MessageKey)}</Badge>
            </div>
            {displayDescription(r) && <p className="text-xs text-fg-muted">{displayDescription(r)}</p>}
            {!r.shots && <p className="line-clamp-3 text-xs text-fg-subtle">{r.promptTemplate}</p>}
            <div className="mt-auto flex items-center gap-1 pt-1">
              {onEdit && (
                <Button variant="ghost" size="sm" leftIcon={<Pencil className="size-3.5" />} onClick={() => onEdit(r)}>
                  {t("common.edit")}
                </Button>
              )}
              <Button variant="ghost" size="sm" leftIcon={<Copy className="size-3.5" />} onClick={() => onDuplicate(r)}>
                {t("common.duplicate")}
              </Button>
              {onDelete && (
                <Button variant="ghost" size="icon-sm" className="ml-auto text-danger" onClick={() => onDelete(r)} aria-label={t("common.delete")}>
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
