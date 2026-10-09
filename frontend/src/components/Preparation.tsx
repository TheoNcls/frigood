import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChefHat, Plus, RotateCcw, X } from "lucide-react";
import { api } from "../api/client";
import { useFridge, useIngredients, useRecipes } from "../api/queries";
import type { FridgeItem, Ingredient, Preparation, Recipe } from "../api/types";
import { useCurrentUser } from "../auth/AuthContext";
import { addDays, todayISO } from "../lib/dates";
import { DUREE_RECETTE_DEFAUT, EXPIRY_STYLES, expiryInfo } from "../lib/fridge";
import { compositionMacros, fmt, preparationPortionMacros, recipeMacros } from "../lib/nutrition";
import { usePickerRecipes, useUsageCounts } from "../lib/usage";
import FoodPicker from "./FoodPicker";
import FoodThumb from "./FoodThumb";
import Modal from "./Modal";
import { useToast } from "./Toast";
import { Field } from "./ui";

interface Row {
  ingredient_id: number;
  quantite: string;
  checked: boolean;
  /** Ajouté à la recette */
  extra: boolean;
  /** Ingrédient en option dans la recette (décoché par défaut) */
  optional: boolean;
}

// Arrondi d'affichage : au gramme, au dixième sous 10 g
const round = (q: number) => (q < 10 ? Math.round(q * 10) / 10 : Math.round(q));
const num = (v: string) => {
  const n = parseFloat(v.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};

const baseQty = (ri: Recipe["ingredients"][number]) =>
  ri.type_mesure === "unite" ? ri.quantite * (ri.ingredient.quantite_defaut ?? 0) : ri.quantite;

/** Ingrédients de la recette d'origine en g / ml, pour ce nombre de portions (sans les options). */
function recipeComposition(recipe: Recipe, portions: number): Map<number, number> {
  const f = portions / (recipe.portions || 1);
  const out = new Map<number, number>();
  for (const ri of recipe.ingredients) {
    if (ri.par_defaut) out.set(ri.ingredient_id, (out.get(ri.ingredient_id) ?? 0) + baseQty(ri) * f);
  }
  return out;
}

/** Lignes du formulaire : tous les ingrédients, les options décochées (mais déjà à la bonne quantité). */
function recipeRows(recipe: Recipe, portions: number): Row[] {
  const f = portions / (recipe.portions || 1);
  const rows: Row[] = [];
  for (const ri of recipe.ingredients) {
    const same = rows.find((r) => r.ingredient_id === ri.ingredient_id);
    if (same) {
      same.quantite = String(round(num(same.quantite) + baseQty(ri) * f));
      continue;
    }
    rows.push({ ingredient_id: ri.ingredient_id, quantite: String(round(baseQty(ri) * f)), checked: ri.par_defaut, extra: false, optional: !ri.par_defaut });
  }
  return rows;
}

const differs = (a: number, b: number) => Math.abs(a - b) > Math.max(1, 0.02 * b);

function sameComposition(mine: Map<number, number>, original: Map<number, number>): boolean {
  return mine.size === original.size && [...mine].every(([id, q]) => original.has(id) && !differs(q, original.get(id)!));
}

/** Ce qui change par rapport à la recette : « sans coriandre · + fromage 60 g · oignon 150 g ». */
export function preparationChanges(prep: Preparation, recipe: Recipe | undefined, ingredients: Map<number, Ingredient>): string[] {
  if (!recipe || !prep.adaptee) return [];
  const original = recipeComposition(recipe, prep.portions);
  const mine = new Map(prep.ingredients.map((i) => [i.ingredient_id, i.quantite]));
  const name = (id: number) => ingredients.get(id)?.nom ?? "?";
  const unit = (id: number) => ingredients.get(id)?.unite ?? "g";
  const out: string[] = [];
  for (const [id] of original) if (!mine.has(id)) out.push(`sans ${name(id).toLowerCase()}`);
  for (const [id, q] of mine) {
    if (!original.has(id)) out.push(`+ ${name(id).toLowerCase()} ${fmt(q)} ${unit(id)}`);
    else if (differs(q, original.get(id)!)) out.push(`${name(id).toLowerCase()} ${fmt(q)} ${unit(id)}`);
  }
  return out;
}

export function useInvalidateFridge() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["fridge"] });
    queryClient.invalidateQueries({ queryKey: ["fridge_history"] });
  };
}

/**
 * Préparer une recette : les ingrédients sont cochés par défaut, aux quantités de la recette
 * pour le nombre de portions choisi. On décoche, on change une quantité, on ajoute un ingrédient :
 * le plat rejoint le frigo avec ce qui a réellement été cuisiné.
 */
export function PrepareRecipeForm({ onDone }: { onDone: (item: FridgeItem) => void }) {
  const user = useCurrentUser();
  const ingredients = useIngredients();
  const recipes = useRecipes();
  const fridge = useFridge();
  const usage = useUsageCounts();
  const invalidate = useInvalidateFridge();
  const toast = useToast();

  const [recipeId, setRecipeId] = useState<number | null>(null);
  // Option du profil « seulement mes ingrédients et recettes »
  const recipePicker = usePickerRecipes(recipeId);
  const [portions, setPortions] = useState("1");
  const [scaledFor, setScaledFor] = useState(1);   // portions pour lesquelles les quantités sont calculées
  const [rows, setRows] = useState<Row[]>([]);
  const [adding, setAdding] = useState(false);
  const [pendingAdd, setPendingAdd] = useState<number | null>(null);
  const [deduire, setDeduire] = useState(true);
  const [dateAchat, setDateAchat] = useState(todayISO());
  const [peremption, setPeremption] = useState<string | null>(null);

  const recipe = recipeId ? recipes.byId.get(recipeId) : undefined;
  const portionsNum = num(portions);
  const peremptionEffective = peremption ?? addDays(dateAchat, DUREE_RECETTE_DEFAUT);
  const fridgeIngIds = useMemo(() => new Set((fridge.data ?? []).flatMap((f) => (f.ingredient_id ? [f.ingredient_id] : []))), [fridge.data]);

  const used = rows.filter((r) => r.checked && num(r.quantite) > 0).map((r) => ({ ingredient_id: r.ingredient_id, quantite: num(r.quantite) }));
  const total = compositionMacros(used, ingredients.byId);
  const perPortion = portionsNum > 0 ? total.cal / portionsNum : 0;

  // Différent de la recette : ingrédient retiré, option ou ingrédient ajouté, quantité changée
  const modified = !!recipe && !sameComposition(new Map(used.map((u) => [u.ingredient_id, u.quantite])), recipeComposition(recipe, scaledFor));

  function chooseRecipe(id: number) {
    const r = recipes.byId.get(id);
    const p = r?.portions || 1;
    setRecipeId(id);
    setPortions(String(p));
    setScaledFor(p);
    setRows(r ? recipeRows(r, p) : []);
    setAdding(false);
  }

  // Plus ou moins de portions : toutes les quantités suivent (y compris celles modifiées)
  function changePortions(v: string) {
    setPortions(v);
    const n = num(v);
    if (n > 0 && scaledFor > 0 && n !== scaledFor) {
      setRows((rs) => rs.map((r) => ({ ...r, quantite: String(round(num(r.quantite) * n / scaledFor)) })));
      setScaledFor(n);
    }
  }

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  function addIngredient() {
    if (!pendingAdd) return;
    const ing = ingredients.byId.get(pendingAdd);
    setRows((rs) => rs.some((r) => r.ingredient_id === pendingAdd)
      ? rs.map((r) => (r.ingredient_id === pendingAdd ? { ...r, checked: true } : r))
      : [...rs, { ingredient_id: pendingAdd, quantite: String(ing?.quantite_defaut ?? 100), checked: true, extra: true, optional: false }]);
    setAdding(false);
    setPendingAdd(null);
  }

  const save = useMutation({
    mutationFn: () => api<FridgeItem>(`/users/${user.id}/fridge/`, {
      method: "POST",
      body: {
        recipe_id: recipeId,
        quantite: portionsNum,
        date_achat: dateAchat,
        date_peremption: peremptionEffective,
        deduire_ingredients: deduire,
        ingredients: used,
      },
    }),
    onSuccess: (item) => {
      invalidate();
      toast(`« ${recipe?.nom} » préparé : ${fmt(portionsNum, 1)} portion(s) au frigo`);
      onDone(item);
    },
    onError: (e) => toast(e.message, "error"),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!recipe) return toast("Choisis une recette", "error");
    if (portionsNum <= 0) return toast("Indique le nombre de portions", "error");
    if (!used.length) return toast("Coche au moins un ingrédient", "error");
    save.mutate();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <FoodPicker label="Recette" items={recipePicker.list} counts={usage.recipes} value={recipeId} onChange={chooseRecipe} />
        {recipePicker.persoOnly && (
          <p className="mt-1 text-xs text-slate-500">
            Tes recettes et celles que tu as déjà préparées ou mangées (option du Profil). Tu peux aussi créer la tienne dans le Catalogue.
          </p>
        )}
      </div>

      {recipe && (
        <>
          <Field
            label="Nombre de portions"
            hint={`Recette prévue pour ${recipe.portions || 1} portion(s) : les quantités suivent le nombre de portions.`}
          >
            <input className="input max-w-[8rem]" type="number" min={0} step="any" value={portions} onChange={(e) => changePortions(e.target.value)} />
          </Field>

          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="label mb-0">Ingrédients utilisés</span>
              {modified && (
                <button type="button" className="btn-ghost py-1 text-xs text-brand-700" onClick={() => setRows(recipeRows(recipe, scaledFor))}>
                  <RotateCcw className="h-3.5 w-3.5" /> Recette d'origine
                </button>
              )}
            </div>
            {rows.length ? (
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {rows.map((r, i) => {
                  const ing = ingredients.byId.get(r.ingredient_id);
                  return (
                    <li key={`${r.ingredient_id}-${i}`} className="flex items-center gap-2 px-3 py-1.5">
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4 shrink-0 accent-brand-600"
                          checked={r.checked}
                          onChange={(e) => setRow(i, { checked: e.target.checked })}
                        />
                        <span className={`truncate text-sm ${r.checked ? "text-slate-800" : r.optional ? "text-slate-500" : "text-slate-400 line-through"}`}>
                          {fridgeIngIds.has(r.ingredient_id) && <span title="Au frigo">🧊 </span>}
                          {ing?.nom ?? "?"}
                        </span>
                        {r.extra && <span className="badge shrink-0 bg-brand-50 text-brand-700">ajouté</span>}
                        {r.optional && <span className="badge shrink-0 bg-slate-100 text-slate-500">option</span>}
                      </label>
                      <input
                        className="input w-20 py-1 text-right"
                        type="number"
                        min={0}
                        step="any"
                        aria-label={`Quantité de ${ing?.nom ?? "l'ingrédient"}`}
                        disabled={!r.checked}
                        value={r.quantite}
                        onChange={(e) => setRow(i, { quantite: e.target.value })}
                      />
                      <span className="w-6 shrink-0 text-xs text-slate-500">{ing?.unite ?? "g"}</span>
                      {r.extra && (
                        <button type="button" className="btn-ghost px-1" aria-label={`Retirer ${ing?.nom ?? ""}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">Cette recette n'a pas encore d'ingrédients : ajoute ceux que tu as utilisés.</p>
            )}

            {adding ? (
              <div className="mt-2 space-y-2 rounded-xl border border-dashed border-slate-300 p-3">
                <FoodPicker label="Ingrédient à ajouter" items={ingredients.list} counts={usage.ingredients} inFridge={fridgeIngIds} value={pendingAdd} onChange={setPendingAdd} />
                <div className="flex justify-end gap-2">
                  <button type="button" className="btn-ghost" onClick={() => { setAdding(false); setPendingAdd(null); }}>Annuler</button>
                  <button type="button" className="btn-secondary" disabled={!pendingAdd} onClick={addIngredient}>Ajouter</button>
                </div>
              </div>
            ) : (
              <button type="button" className="btn-ghost mt-1 text-brand-700" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> Ajouter un ingrédient
              </button>
            )}

            {total.cal > 0 && (
              <p className="mt-1 text-xs text-slate-500">
                ≈ {fmt(total.cal)} kcal en tout{portionsNum > 0 && <> · <span className="font-medium text-slate-700">{fmt(perPortion)} kcal par portion</span>
                {" "}· P {fmt(total.prot / portionsNum, 1)} g · G {fmt(total.gluc / portionsNum, 1)} g · L {fmt(total.lip / portionsNum, 1)} g</>}
              </p>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={deduire} onChange={(e) => setDeduire(e.target.checked)} />
            Retirer du frigo les ingrédients utilisés (🧊)
          </label>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Date de préparation">
              <input className="input" type="date" value={dateAchat} onChange={(e) => e.target.value && setDateAchat(e.target.value)} />
            </Field>
            <Field label="Péremption" hint={`Conservation par défaut : ${DUREE_RECETTE_DEFAUT} jour(s)`}>
              <input className="input" type="date" value={peremptionEffective} onChange={(e) => setPeremption(e.target.value || null)} />
            </Field>
          </div>
        </>
      )}

      <button type="submit" className="btn-primary w-full" disabled={save.isPending || !recipe}>
        <ChefHat className="h-4 w-4" />
        {recipe && portionsNum > 0 ? `Préparer · ${fmt(portionsNum, 1)} portion(s) au frigo` : "Préparer"}
      </button>
    </form>
  );
}

export function PrepareRecipeModal({ onClose, onDone }: { onClose: () => void; onDone: (item: FridgeItem) => void }) {
  return (
    <Modal title="Préparer une recette" onClose={onClose}>
      <PrepareRecipeForm onDone={(item) => { onDone(item); onClose(); }} />
    </Modal>
  );
}

/** kcal d'une portion : celle du plat préparé, sinon (ancien plat) celle de la recette. */
function dishPortionKcal(item: FridgeItem, recipe: Recipe | undefined, ingredients: Map<number, Ingredient>): number {
  if (item.preparation) return preparationPortionMacros(item.preparation, ingredients).cal;
  return recipe ? recipeMacros(recipe).cal / (recipe.portions || 1) : 0;
}

/** Plats préparés du frigo : on choisit celui dont on mange une part. */
export function DishPicker({ value, onChange, onPrepare }: { value: number | null; onChange: (id: number) => void; onPrepare: () => void }) {
  const fridge = useFridge();
  const ingredients = useIngredients();
  const recipes = useRecipes();
  const dishes = (fridge.data ?? [])
    .filter((f) => f.recipe_id)
    .sort((a, b) => (a.date_peremption ?? "9999").localeCompare(b.date_peremption ?? "9999"));

  return (
    <div>
      <span className="label">Plat préparé</span>
      {dishes.length ? (
        <ul className="space-y-1.5">
          {dishes.map((d) => {
            const recipe = recipes.byId.get(d.recipe_id!);
            const exp = expiryInfo(d.date_peremption);
            const changes = d.preparation ? preparationChanges(d.preparation, recipe, ingredients.byId) : [];
            const on = d.id === value;
            return (
              <li key={d.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange(d.id)}
                  className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2 text-left transition ${on ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-slate-200 bg-white hover:border-slate-300"}`}
                >
                  <FoodThumb nom={recipe?.nom ?? ""} recipe />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-slate-900">
                      {recipe?.nom ?? "(recette supprimée)"}
                      {d.preparation?.adaptee && <span className="badge ml-1.5 bg-violet-50 align-middle text-violet-700">ma version</span>}
                    </span>
                    <span className="block text-xs text-slate-500">
                      {fmt(d.quantite, 1)} portion(s) · ≈ {fmt(dishPortionKcal(d, recipe, ingredients.byId))} kcal / portion
                    </span>
                    {changes.length > 0 && <span className="block truncate text-xs text-violet-700">{changes.join(" · ")}</span>}
                  </span>
                  <span className={`badge shrink-0 ${EXPIRY_STYLES[exp.level]}`}>{exp.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-500">
          Aucun plat préparé dans ton frigo. Pour noter une recette, prépare-la d'abord.
        </p>
      )}
      <button type="button" className="btn-ghost mt-1 text-brand-700" onClick={onPrepare}>
        <ChefHat className="h-4 w-4" /> Préparer une recette
      </button>
    </div>
  );
}
