import { useMemo } from "react";
import { useMealLogs } from "../api/queries";

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
