import { useMemo } from "react";
import { useFridge, useFridgeHistory, useIngredients, useMealLogs } from "../api/queries";
import { useCurrentUser } from "../auth/AuthContext";

/** Nombre d'utilisations de chaque ingrédient / recette dans tous les repas, pour trier les listes. */
export function useUsageCounts() {
  const { data } = useMealLogs();
  return useMemo(() => {
    const ingredients = new Map<number, number>();
    const recipes = new Map<number, number>();
    for (const log of data ?? []) {
      if (log.ingredient_id) ingredients.set(log.ingredient_id, (ingredients.get(log.ingredient_id) ?? 0) + 1);
      if (log.recipe_id) recipes.set(log.recipe_id, (recipes.get(log.recipe_id) ?? 0) + 1);
    }
    return { ingredients, recipes };
  }, [data]);
}

export function sortByUsage<T extends { id: number; nom: string }>(items: T[], counts: Map<number, number>): T[] {
  return [...items].sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.nom.localeCompare(b.nom, "fr"));
}

/**
 * Ingrédients proposés dans Repas et Frigo. Avec l'option « seulement mes ingrédients » du profil :
 * les siens, ceux déjà mangés ou passés par le frigo, et celui qu'on vient de choisir (un produit scanné).
 */
export function usePickerIngredients(selectedId: number | null) {
  const user = useCurrentUser();
  const persoOnly = user.ingredients_perso_seulement;
  const ingredients = useIngredients();
  const usage = useUsageCounts();
  const fridge = useFridge();
  const history = useFridgeHistory({ enabled: persoOnly });
  const list = useMemo(() => {
    if (!persoOnly) return ingredients.list;
    const keep = new Set<number>(usage.ingredients.keys());
    for (const f of fridge.data ?? []) if (f.ingredient_id) keep.add(f.ingredient_id);
    for (const h of history.data ?? []) if (h.ingredient_id) keep.add(h.ingredient_id);
    if (selectedId) keep.add(selectedId);
    return ingredients.list.filter((i) => i.created_by === user.id || keep.has(i.id));
  }, [persoOnly, ingredients.list, usage.ingredients, fridge.data, history.data, selectedId, user.id]);
  return { list, persoOnly };
}
