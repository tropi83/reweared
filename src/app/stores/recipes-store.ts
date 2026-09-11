import { create } from "zustand";
import type { Recipe } from "@/domain/models";
import { BUILT_IN_RECIPES } from "@/domain/services/recipes";
import { createId, nowIso } from "@/lib/ids";
import { getServices } from "../services";

interface RecipesState {
  custom: Recipe[];
  loaded: boolean;
  all(): Recipe[];
  load(): Promise<void>;
  save(input: Pick<Recipe, "name" | "promptTemplate" | "category"> & { id?: string; description?: string }): Promise<Recipe>;
  remove(id: string): Promise<void>;
  duplicate(id: string): Promise<Recipe | null>;
}

export const useRecipesStore = create<RecipesState>((set, get) => ({
  custom: [],
  loaded: false,
  all: () => [...BUILT_IN_RECIPES, ...get().custom],
  async load() {
    const custom = await getServices().storage.listRecipes();
    set({ custom: custom.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), loaded: true });
  },
  async save(input) {
    const now = nowIso();
    const existing = input.id ? get().custom.find((r) => r.id === input.id) : undefined;
    const recipe: Recipe = {
      id: existing?.id ?? createId("rcp"),
      name: input.name.trim() || "Untitled recipe",
      promptTemplate: input.promptTemplate,
      category: input.category,
      ...(input.description?.trim() ? { description: input.description.trim() } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await getServices().storage.saveRecipe(recipe);
    set({ custom: [recipe, ...get().custom.filter((r) => r.id !== recipe.id)] });
    return recipe;
  },
  async remove(id) {
    await getServices().storage.deleteRecipe(id);
    set({ custom: get().custom.filter((r) => r.id !== id) });
  },
  async duplicate(id) {
    const source = get()
      .all()
      .find((r) => r.id === id);
    if (!source) return null;
    return get().save({
      name: `${source.name} (copy)`,
      promptTemplate: source.promptTemplate,
      category: source.builtIn ? "custom" : source.category,
      ...(source.description ? { description: source.description } : {}),
    });
  },
}));
