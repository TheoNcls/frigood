import type { Ingredient, MealLog, Moment, Recipe } from "../api/types";

export interface Macros {
  cal: number;
  prot: number;
  gluc: number;
  lip: number;
}

export const ZERO: Macros = { cal: 0, prot: 0, gluc: 0, lip: 0 };

export const MOMENTS: Moment[] = ["matin", "midi", "soir", "snack"];

export const MOMENT_LABELS: Record<Moment, string> = {
  matin: "Matin", midi: "Midi", soir: "Soir", snack: "Snack",
};

export function defaultMoment(hour = new Date().getHours()): Moment {
  if (hour >= 5 && hour < 10) return "matin";
  if (hour >= 10 && hour < 14) return "midi";
  if (hour >= 14 && hour < 19) return "snack";
  return "soir";
}

export function addMacros(a: Macros, b: Macros): Macros {
  return { cal: a.cal + b.cal, prot: a.prot + b.prot, gluc: a.gluc + b.gluc, lip: a.lip + b.lip };
}

function scale(m: Macros, f: number): Macros {
  return { cal: m.cal * f, prot: m.prot * f, gluc: m.gluc * f, lip: m.lip * f };
}

function ingredientMacros(ing: Ingredient, grams: number): Macros {
  const f = grams / 100;
  return {
    cal: (ing.calories ?? 0) * f,
    prot: (ing.proteines ?? 0) * f,
    gluc: (ing.glucides ?? 0) * f,
    lip: (ing.lipides ?? 0) * f,
  };
}

/** Macros de la recette complète (toutes portions). */
export function recipeMacros(recipe: Recipe): Macros {
  return recipe.ingredients.reduce((acc, ri) => {
    const grams = ri.type_mesure === "unite" ? ri.quantite * (ri.ingredient.quantite_defaut ?? 0) : ri.quantite;
    return addMacros(acc, ingredientMacros(ri.ingredient, grams));
  }, ZERO);
}

export function logMacros(
  log: Pick<MealLog, "recipe_id" | "ingredient_id" | "quantite" | "type_mesure">,
  ingredients: Map<number, Ingredient>,
  recipes: Map<number, Recipe>,
): Macros {
  const q = log.quantite ?? 0;
  if (log.recipe_id) {
    const recipe = recipes.get(log.recipe_id);
    if (!recipe) return ZERO;
    return scale(recipeMacros(recipe), (q || 1) / (recipe.portions || 1));
  }
  if (log.ingredient_id) {
    const ing = ingredients.get(log.ingredient_id);
    if (!ing) return ZERO;
    const grams = log.type_mesure === "unite" ? q * (ing.quantite_defaut ?? 0) : q;
    return ingredientMacros(ing, grams);
  }
  return ZERO;
}

export function totalMacros(logs: MealLog[], ingredients: Map<number, Ingredient>, recipes: Map<number, Recipe>): Macros {
  return logs.reduce((acc, log) => addMacros(acc, logMacros(log, ingredients, recipes)), ZERO);
}

export function describeLog(log: MealLog, ingredients: Map<number, Ingredient>, recipes: Map<number, Recipe>): string {
  const q = log.quantite ?? 0;
  if (log.recipe_id) {
    const r = recipes.get(log.recipe_id);
    return `${r?.nom ?? "?"} × ${fmt(q || 1, 1)} portion(s)`;
  }
  const ing = log.ingredient_id ? ingredients.get(log.ingredient_id) : undefined;
  if (log.type_mesure === "unite") return `${ing?.nom ?? "?"} × ${fmt(q, 1)} unité(s)`;
  return `${ing?.nom ?? "?"} ${fmt(q)} ${ing?.unite ?? "g"}`;
}

export function fmt(n: number, decimals = 0): string {
  return n.toLocaleString("fr-FR", { maximumFractionDigits: decimals, minimumFractionDigits: 0 });
}
