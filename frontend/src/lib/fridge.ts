import type { FridgeAction, Ingredient, Recipe } from "../api/types";
import { daysBetween, todayISO } from "./dates";
import { fmt } from "./nutrition";

interface FridgeLike {
  ingredient_id: number | null;
  recipe_id: number | null;
  quantite: number;
}

export function fridgeItemName(item: FridgeLike, ingredients: Map<number, Ingredient>, recipes: Map<number, Recipe>): string {
  if (item.ingredient_id) return ingredients.get(item.ingredient_id)?.nom ?? "(ingrédient supprimé)";
  if (item.recipe_id) return recipes.get(item.recipe_id)?.nom ?? "(recette supprimée)";
  return "(supprimé)";
}

export function fridgeItemQty(item: FridgeLike, ingredients: Map<number, Ingredient>, signed = false): string {
  const q = item.quantite;
  const sign = signed && q > 0 ? "+" : "";
  if (item.recipe_id) return `${sign}${fmt(q, 1)} portion(s)`;
  const ing = item.ingredient_id ? ingredients.get(item.ingredient_id) : undefined;
  let txt = `${sign}${fmt(q)} ${ing?.unite ?? "g"}`;
  if (!signed && ing?.quantite_defaut) txt += ` (≈ ${fmt(q / ing.quantite_defaut, 1)} unité(s))`;
  return txt;
}

export type ExpiryLevel = "expired" | "urgent" | "soon" | "ok" | "none";

export function expiryInfo(datePeremption: string | null): { level: ExpiryLevel; label: string; days: number | null } {
  if (!datePeremption) return { level: "none", label: "Pas de date", days: null };
  const days = daysBetween(todayISO(), datePeremption);
  if (days < 0) return { level: "expired", label: `Périmé depuis ${-days} j`, days };
  if (days === 0) return { level: "expired", label: "Périme aujourd'hui", days };
  if (days <= 2) return { level: "urgent", label: `J-${days}`, days };
  if (days <= 5) return { level: "soon", label: `J-${days}`, days };
  return { level: "ok", label: `J-${days}`, days };
}

export const EXPIRY_STYLES: Record<ExpiryLevel, string> = {
  expired: "bg-red-100 text-red-700",
  urgent: "bg-orange-100 text-orange-700",
  soon: "bg-amber-100 text-amber-700",
  ok: "bg-emerald-100 text-emerald-700",
  none: "bg-slate-100 text-slate-500",
};

export const ACTION_LABELS: Record<FridgeAction, string> = {
  ajout: "Ajout",
  repas: "Repas",
  cuisine: "Cuisine",
  modification: "Modification",
  consomme: "Consommé",
  perime: "Périmé / jeté",
  suppression: "Retiré",
};

export const DUREE_RECETTE_DEFAUT = 3;
