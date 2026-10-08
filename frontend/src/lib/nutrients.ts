import type { Ingredient, MealLog, Recipe } from "../api/types";

export type NutrientGoal = "min" | "max";

/** Repères pour un adulte (ANSES / EFSA), proposés par défaut : à adapter dans le profil. */
const REFERENCES: Record<string, { cible: number; sens: NutrientGoal; note?: string }> = {
  "fibres": { cible: 30, sens: "min" },
  "sucres": { cible: 100, sens: "max" },
  "acides gras saturés": { cible: 20, sens: "max" },
  "oméga-3": { cible: 2.5, sens: "min" },
  "sel": { cible: 6, sens: "max" },
  "sodium": { cible: 2300, sens: "max" },
  "calcium": { cible: 950, sens: "min" },
  "fer": { cible: 11, sens: "min", note: "Repère 11 mg ; 16 mg pour une femme avant la ménopause. Le fer végétal s'absorbe moins bien." },
  "zinc": { cible: 11, sens: "min", note: "Un peu plus avec une alimentation surtout végétale." },
  "magnésium": { cible: 350, sens: "min" },
  "potassium": { cible: 3500, sens: "min" },
  "vitamine c": { cible: 110, sens: "min" },
  "vitamine b12": { cible: 4, sens: "min", note: "Quasi absente des végétaux : souvent complémentée en végétarien / végan." },
  "vitamine d": { cible: 15, sens: "min" },
  "vitamine b9": { cible: 330, sens: "min" },
  "iode": { cible: 150, sens: "min" },
  "sélénium": { cible: 70, sens: "min" },
};

export function nutrientReference(nom: string) {
  return REFERENCES[nom.trim().toLowerCase()];
}

/** Nutriments apportés par des repas (quantité dans l'unité du nutriment), et les aliments qu'ils contiennent. */
export function dayNutrients(logs: MealLog[], ingredients: Map<number, Ingredient>, recipes: Map<number, Recipe>) {
  const amounts = new Map<number, number>();
  const foods = new Map<number, Ingredient>();
  const add = (ing: Ingredient | undefined, grams: number) => {
    if (!ing || grams <= 0) return;
    foods.set(ing.id, ing);
    for (const n of ing.nutriments) amounts.set(n.nutriment_id, (amounts.get(n.nutriment_id) ?? 0) + (n.valeur * grams) / 100);
  };
  for (const log of logs) {
    const q = log.quantite ?? 0;
    if (log.preparation) {
      // Part d'un plat préparé : ce qui a réellement été cuisiné
      const f = (q || 1) / (log.preparation.portions || 1);
      for (const it of log.preparation.ingredients) add(ingredients.get(it.ingredient_id), it.quantite * f);
    } else if (log.recipe_id) {
      const r = recipes.get(log.recipe_id);
      if (!r) continue;
      const f = (q || 1) / (r.portions || 1);
      for (const ri of r.ingredients) {
        if (!ri.par_defaut) continue;
        const grams = ri.type_mesure === "unite" ? ri.quantite * (ri.ingredient.quantite_defaut ?? 0) : ri.quantite;
        add(ingredients.get(ri.ingredient_id) ?? ri.ingredient, grams * f);
      }
    } else if (log.ingredient_id) {
      const ing = ingredients.get(log.ingredient_id);
      add(ing, log.type_mesure === "unite" ? q * (ing?.quantite_defaut ?? 0) : q);
    }
  }
  return { amounts, foods };
}

/** Aliments du jour sans valeur connue pour ce nutriment : le total affiché est alors partiel. */
export function foodsWithout(foods: Map<number, Ingredient>, nutrimentId: number): Ingredient[] {
  return [...foods.values()].filter((f) => !f.nutriments.some((n) => n.nutriment_id === nutrimentId));
}

/** Décimales d'affichage : µg et petites valeurs en mg au dixième. */
export function nutrientDecimals(unit: string, target: number | null): number {
  if (unit === "µg" || unit === "g") return 1;
  return target !== null && target < 20 ? 1 : 0;
}
