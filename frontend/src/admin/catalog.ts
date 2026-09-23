import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Ingredient, IngredientInput, Nutriment, NutrimentSuggestion } from "../api/types";

export type SourceType = "claude" | "openfoodfacts" | "manual";

export const SOURCE_LABELS: Record<string, string> = {
  claude: "Claude",
  openfoodfacts: "OpenFoodFacts",
  manual: "Manuel",
  import: "Import Excel",
};

/** Rafraîchit tout le catalogue : les recettes embarquent les ingrédients, donc on invalide ensemble. */
export function useInvalidateCatalog() {
  const queryClient = useQueryClient();
  return () => {
    for (const key of ["ingredients", "recipes", "nutriments", "activity_types"]) {
      queryClient.invalidateQueries({ queryKey: [key] });
    }
  };
}

/** Retrouve un nutriment par son nom (sans tenir compte de la casse), ou le crée. */
export async function findOrCreateNutriment(nom: string, unite: string, known: Nutriment[]): Promise<Nutriment> {
  const existing = known.find((n) => n.nom.toLowerCase() === nom.trim().toLowerCase());
  if (existing) return existing;
  try {
    const created = await api<Nutriment>("/nutriments/", { method: "POST", body: { nom: nom.trim(), unite } });
    known.push(created);
    return created;
  } catch (e) {
    // Créé entre-temps (par un autre onglet par exemple) : on le relit
    const fresh = await api<Nutriment[]>("/nutriments/");
    const found = fresh.find((n) => n.nom.toLowerCase() === nom.trim().toLowerCase());
    if (found) return found;
    throw e;
  }
}

export async function linkNutriments(ingredientId: number, nutriments: NutrimentSuggestion[], known: Nutriment[]): Promise<number> {
  let added = 0;
  for (const n of nutriments) {
    const nutriment = await findOrCreateNutriment(n.nom, n.unite, known);
    await api(`/ingredients/${ingredientId}/nutriments/`, {
      method: "POST",
      body: { nutriment_id: nutriment.id, valeur: n.valeur, notes: null },
    });
    added++;
  }
  return added;
}

export async function createIngredient(
  values: IngredientInput,
  nutriments: NutrimentSuggestion[],
  source: { type: SourceType; codeBarre?: string | null; rawData?: string | null },
  knownNutriments: Nutriment[],
): Promise<{ ingredient: Ingredient; added: number }> {
  const ingredient = await api<Ingredient>("/ingredients/", {
    method: "POST",
    body: {
      ...values,
      source_type: source.type,
      source_code_barre: source.codeBarre ?? null,
      source_raw_data: source.rawData ?? null,
    },
  });
  const added = await linkNutriments(ingredient.id, nutriments, [...knownNutriments]);
  return { ingredient, added };
}

export function parseNum(v: string): number | null {
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
