import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { api } from "../api/client";
import { useFridge, useIngredients, useMealLogs, useRecipes } from "../api/queries";
import type { MealLog, MealLogCreate, Moment, TypeMesure } from "../api/types";
import { useCurrentUser } from "../auth/AuthContext";
import FoodPicker from "../components/FoodPicker";
import { useToast } from "../components/Toast";
import { Card, Empty, ErrorMessage, Field, MacroTile, PageHeader, Segmented, Spinner } from "../components/ui";
import { formatLong, todayISO } from "../lib/dates";
import {
  MOMENTS, MOMENT_LABELS, defaultMoment, describeLog, fmt, logMacros, totalMacros,
} from "../lib/nutrition";
import { useUsageCounts } from "../lib/usage";

export default function Meals() {
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [date, setDate] = useState(todayISO());
  const ingredients = useIngredients();
  const recipes = useRecipes();
  const meals = useMealLogs({ date });
  const fridge = useFridge();
  const usage = useUsageCounts();

  const [moment, setMoment] = useState<Moment>(defaultMoment());
  const [kind, setKind] = useState<"recette" | "ingredient">("recette");
  const [recipeId, setRecipeId] = useState<number | null>(null);
  const [ingredientId, setIngredientId] = useState<number | null>(null);
  const [mesure, setMesure] = useState<TypeMesure>("poids");
  const [quantite, setQuantite] = useState("1");
  const [notes, setNotes] = useState("");

  const recipe = recipeId ? recipes.byId.get(recipeId) : undefined;
  const ingredient = ingredientId ? ingredients.byId.get(ingredientId) : undefined;

  const fridgeIngIds = useMemo(() => new Set((fridge.data ?? []).flatMap((f) => (f.ingredient_id ? [f.ingredient_id] : []))), [fridge.data]);
  const fridgeRecIds = useMemo(() => new Set((fridge.data ?? []).flatMap((f) => (f.recipe_id ? [f.recipe_id] : []))), [fridge.data]);

  function chooseIngredient(id: number) {
    setIngredientId(id);
    setMesure("poids");
    setQuantite(String(ingredients.byId.get(id)?.quantite_defaut ?? 100));
  }

  function chooseMesure(m: TypeMesure) {
    setMesure(m);
    setQuantite(m === "unite" ? "1" : String(ingredient?.quantite_defaut ?? 100));
  }

  function chooseKind(k: "recette" | "ingredient") {
    setKind(k);
    setMesure("poids");
    setQuantite(k === "recette" ? "1" : String(ingredient?.quantite_defaut ?? 100));
  }

  function chooseRecipe(id: number) {
    setRecipeId(id);
    setQuantite("1");
  }

  const addMeal = useMutation({
    mutationFn: (payload: MealLogCreate) => api<MealLog>(`/users/${user.id}/meal_logs/`, { method: "POST", body: payload }),
    onSuccess: (log) => {
      queryClient.invalidateQueries({ queryKey: ["meal_logs"] });
      queryClient.invalidateQueries({ queryKey: ["fridge"] });
      queryClient.invalidateQueries({ queryKey: ["fridge_history"] });
      toast(log.fridge_updates.length ? `Repas ajouté ! 🧊 Retiré du frigo : ${log.fridge_updates.join(", ")}` : "Repas ajouté !");
      setNotes("");
    },
    onError: (e) => toast(e.message, "error"),
  });

  const deleteMeal = useMutation({
    mutationFn: (id: number) => api(`/meal_logs/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["meal_logs"] }),
    onError: (e) => toast(e.message, "error"),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    const q = parseFloat(quantite);
    if (!Number.isFinite(q) || q <= 0) return toast("Indique une quantité positive", "error");
    if (kind === "recette" && !recipeId) return toast("Choisis une recette", "error");
    if (kind === "ingredient" && !ingredientId) return toast("Choisis un ingrédient", "error");
    addMeal.mutate({
      date,
      moment,
      recipe_id: kind === "recette" ? recipeId : null,
      ingredient_id: kind === "ingredient" ? ingredientId : null,
      quantite: q,
      type_mesure: kind === "ingredient" ? mesure : "poids",
      notes: notes.trim() || null,
    });
  }

  const logs = [...(meals.data ?? [])].sort((a, b) => MOMENTS.indexOf(a.moment) - MOMENTS.indexOf(b.moment));
  const total = totalMacros(logs, ingredients.byId, recipes.byId);
  const preview = logMacros(
    { recipe_id: kind === "recette" ? recipeId : null, ingredient_id: kind === "ingredient" ? ingredientId : null, quantite: parseFloat(quantite) || 0, type_mesure: mesure },
    ingredients.byId, recipes.byId,
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="Repas"
        subtitle={formatLong(date)}
        action={<input type="date" className="input w-auto" value={date} max={todayISO()} onChange={(e) => e.target.value && setDate(e.target.value)} />}
      />

      <Card title="Bilan du jour">
        <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
          <MacroTile label="Calories" value={total.cal} target={user.calories_cible} unit="kcal" />
          <MacroTile label="Protéines" value={total.prot} target={user.proteines_cible} unit="g" />
          <MacroTile label="Glucides" value={total.gluc} target={user.glucides_cible} unit="g" />
          <MacroTile label="Lipides" value={total.lip} target={user.lipides_cible} unit="g" />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card title="Ajouter un repas" className="lg:col-span-2">
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-3">
              <Field label="Moment">
                <select className="input" value={moment} onChange={(e) => setMoment(e.target.value as Moment)}>
                  {MOMENTS.map((m) => <option key={m} value={m}>{MOMENT_LABELS[m]}</option>)}
                </select>
              </Field>
              <div>
                <span className="label">Type</span>
                <Segmented
                  full
                  value={kind}
                  onChange={chooseKind}
                  options={[{ value: "recette", label: "Recette" }, { value: "ingredient", label: "Ingrédient" }]}
                />
              </div>
            </div>

            {kind === "recette" ? (
              <FoodPicker label="Recette" items={recipes.list} counts={usage.recipes} inFridge={fridgeRecIds} value={recipeId} onChange={chooseRecipe} />
            ) : (
              <FoodPicker label="Ingrédient" items={ingredients.list} counts={usage.ingredients} inFridge={fridgeIngIds} value={ingredientId} onChange={chooseIngredient} />
            )}

            {kind === "ingredient" && ingredient?.quantite_defaut ? (
              <div>
                <span className="label">Mesure</span>
                <Segmented
                  full
                  value={mesure}
                  onChange={chooseMesure}
                  options={[{ value: "poids", label: `Poids (${ingredient.unite})` }, { value: "unite", label: "Unité" }]}
                />
              </div>
            ) : null}

            <Field
              label={kind === "recette" ? "Portions consommées" : mesure === "unite" ? "Nombre d'unités" : `Quantité (${ingredient?.unite ?? "g"})`}
              hint={
                kind === "recette" && recipe && (recipe.portions ?? 1) > 1
                  ? `Recette prévue pour ${recipe.portions} portions`
                  : kind === "ingredient" && mesure === "unite" && ingredient
                    ? `1 unité ≈ ${ingredient.quantite_defaut} ${ingredient.unite}`
                    : undefined
              }
            >
              <input className="input" type="number" min={0} step="any" value={quantite} onChange={(e) => setQuantite(e.target.value)} />
            </Field>

            <Field label="Notes (optionnel)">
              <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>

            {preview.cal > 0 && (
              <p className="text-xs text-slate-500">
                ≈ {fmt(preview.cal)} kcal · P {fmt(preview.prot, 1)} g · G {fmt(preview.gluc, 1)} g · L {fmt(preview.lip, 1)} g
              </p>
            )}

            <button type="submit" className="btn-primary w-full" disabled={addMeal.isPending}>
              {addMeal.isPending ? "Ajout…" : "Ajouter"}
            </button>
          </form>
        </Card>

        <Card title="Repas de la journée" className="lg:col-span-3">
          {meals.isLoading ? <Spinner /> : meals.error ? <ErrorMessage error={meals.error} /> : !logs.length ? (
            <Empty>Aucun repas enregistré pour cette journée.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {logs.map((log) => {
                const m = logMacros(log, ingredients.byId, recipes.byId);
                return (
                  <li key={log.id} className="flex items-start gap-3 py-3">
                    <span className="badge mt-0.5 bg-slate-100 text-slate-600">{MOMENT_LABELS[log.moment] ?? log.moment}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-slate-900">
                        {log.recipe_id ? "🍽️ " : "🥗 "}{describeLog(log, ingredients.byId, recipes.byId)}
                      </div>
                      <div className="text-xs text-slate-500">
                        {fmt(m.cal)} kcal · P {fmt(m.prot, 1)} g · G {fmt(m.gluc, 1)} g · L {fmt(m.lip, 1)} g
                      </div>
                      {log.notes && <div className="mt-0.5 text-xs italic text-slate-500">{log.notes}</div>}
                    </div>
                    <button
                      className="btn-ghost"
                      aria-label="Supprimer"
                      disabled={deleteMeal.isPending}
                      onClick={() => deleteMeal.mutate(log.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
