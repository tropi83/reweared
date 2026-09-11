import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Dialog } from "@/components/ui/Dialog";
import { Input } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Misc";
import type { Recipe } from "@/domain/models";
import { extractVariables } from "@/domain/services/recipes";
import { useT, type MessageKey } from "@/i18n";

export function RecipePicker({ open, onClose, recipes, onPick }: { open: boolean; onClose: () => void; recipes: Recipe[]; onPick: (recipe: Recipe) => void }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recipes;
    return recipes.filter((r) => `${r.name} ${r.description ?? ""} ${r.category}`.toLowerCase().includes(q));
  }, [recipes, query]);

  return (
    <Dialog open={open} onClose={onClose} title={t("recipes.title")} description={t("recipes.subtitle")} size="lg">
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("common.select")}
          className="pl-8"
          autoFocus
          aria-label={t("recipes.title")}
        />
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {filtered.map((recipe) => (
          <li key={recipe.id}>
            <button
              type="button"
              onClick={() => onPick(recipe)}
              className="flex h-full w-full flex-col gap-1.5 rounded-xl border border-border bg-bg p-3 text-left transition-colors hover:border-accent hover:bg-accent-soft/40"
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{recipe.name}</span>
                <Badge className="ml-auto">{t(`recipes.category.${recipe.category}` as MessageKey)}</Badge>
              </div>
              {recipe.description && <p className="text-xs text-fg-muted">{recipe.description}</p>}
              <p className="line-clamp-2 text-xs text-fg-subtle">{recipe.promptTemplate}</p>
              {extractVariables(recipe.promptTemplate).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {extractVariables(recipe.promptTemplate).map((v) => (
                    <Badge key={v} tone="accent">
                      {`{{${v}}}`}
                    </Badge>
                  ))}
                </div>
              )}
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
