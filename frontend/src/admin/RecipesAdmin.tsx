import { useMemo, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Clock, Plus, Search, Trash2, Users } from "lucide-react";
import { api } from "../api/client";
import { useIngredients, useRecipes } from "../api/queries";
import type { Recipe, RecipeInput, TypeMesure } from "../api/types";
import FoodPicker from "../components/FoodPicker";
import Modal from "../components/Modal";
import { useToast } from "../components/Toast";
import { Card, ConfirmButton, Empty, Field, Segmented, Spinner, Stat } from "../components/ui";
import { fmt, recipeMacros } from "../lib/nutrition";
import { parseNum, useInvalidateCatalog } from "./catalog";

const NO_COUNTS = new Map<number, number>();

function recipeExtras(recipe: Recipe) {
  const extras = new Map<string, { valeur: number; unite: string }>();
  for (const ri of recipe.ingredients) {
    const grams = ri.type_mesure === "unite" ? ri.quantite * (ri.ingredient.quantite_defaut ?? 0) : ri.quantite;
    for (const n of ri.ingredient.nutriments) {
      const e = extras.get(n.nutriment.nom) ?? { valeur: 0, unite: n.nutriment.unite };
      e.valeur += (n.valeur * grams) / 100;
      extras.set(n.nutriment.nom, e);
    }
  }
  return [...extras.entries()].sort((a, b) => a[0].localeCompare(b[0], "fr"));
}

export default function RecipesAdmin() {
  const recipes = useRecipes();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return recipes.list
      .filter((r) => !s || r.nom.toLowerCase().includes(s) || (r.categorie ?? "").toLowerCase().includes(s))
      .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  }, [recipes.list, search]);

  const editing = editingId ? recipes.byId.get(editingId) : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative min-w-[14rem] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Rechercher une recette…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className="btn-primary" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> Nouvelle recette
        </button>
      </div>

      {recipes.isLoading ? <Spinner /> : !rows.length ? (
        <Card><Empty>{search ? "Aucune recette ne correspond." : "Aucune recette pour l'instant."}</Empty></Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {rows.map((r) => {
            const m = recipeMacros(r);
            const portions = r.portions || 1;
            return (
              <li key={r.id}>
                <button className="card w-full text-left transition hover:border-brand-500" onClick={() => setEditingId(r.id)}>
                  <div className="font-medium text-slate-900">{r.nom}</div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                    {r.categorie && <span>{r.categorie}</span>}
                    <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" /> {portions} portion(s)</span>
                    {r.temps_preparation ? <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" /> {r.temps_preparation} min</span> : null}
                    <span>{r.ingredients.length} ingrédient(s)</span>
                  </div>
                  <div className="mt-2 text-sm text-slate-700">
                    {r.ingredients.length ? `${fmt(m.cal / portions)} kcal par portion · P ${fmt(m.prot / portions, 1)} g` : "Aucun ingrédient"}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {creating && (
        <Modal title="Nouvelle recette" onClose={() => setCreating(false)}>
          <CreateRecipe onCreated={(id) => { setCreating(false); setEditingId(id); }} onCancel={() => setCreating(false)} />
        </Modal>
      )}
      {editing && (
        <Modal title={editing.nom} onClose={() => setEditingId(null)} wide>
          <EditRecipe recipe={editing} onDeleted={() => setEditingId(null)} />
        </Modal>
      )}
    </div>
  );
}

function RecipeForm({ initial, submitLabel, pending, onSubmit, onCancel }: {
  initial?: Partial<RecipeInput>;
  submitLabel: string;
  pending?: boolean;
  onSubmit: (v: RecipeInput) => void;
  onCancel?: () => void;
}) {
  const [f, setF] = useState({
    nom: initial?.nom ?? "",
    categorie: initial?.categorie ?? "",
    portions: String(initial?.portions ?? 1),
    temps: initial?.temps_preparation ? String(initial.temps_preparation) : "",
    description: initial?.description ?? "",
  });
  const set = (key: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [key]: e.target.value });

  function submit(e: FormEvent) {
    e.preventDefault();
    const portions = parseNum(f.portions);
    const temps = parseNum(f.temps);
    onSubmit({
      nom: f.nom.trim(),
      categorie: f.categorie.trim() || null,
      portions: portions && portions > 0 ? Math.round(portions) : 1,
      temps_preparation: temps && temps > 0 ? Math.round(temps) : null,
      description: f.description.trim() || null,
    });
  }

  return (
    <form className="space-y-3" onSubmit={submit}>
      <Field label="Nom"><input className="input" required value={f.nom} onChange={set("nom")} /></Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Catégorie" hint="plat, dessert…"><input className="input" value={f.categorie} onChange={set("categorie")} /></Field>
        <Field label="Portions"><input className="input" type="number" min={1} step={1} value={f.portions} onChange={set("portions")} /></Field>
        <Field label="Préparation (min)"><input className="input" type="number" min={0} step={5} value={f.temps} onChange={set("temps")} /></Field>
      </div>
      <Field label="Description / étapes"><textarea className="input min-h-[5rem]" value={f.description} onChange={set("description")} /></Field>
      <div className="flex justify-end gap-2">
        {onCancel && <button type="button" className="btn-secondary" onClick={onCancel}>Annuler</button>}
        <button type="submit" className="btn-primary" disabled={pending}>{submitLabel}</button>
      </div>
    </form>
  );
}

function CreateRecipe({ onCreated, onCancel }: { onCreated: (id: number) => void; onCancel: () => void }) {
  const invalidate = useInvalidateCatalog();
  const toast = useToast();
  const create = useMutation({
    mutationFn: (v: RecipeInput) => api<Recipe>("/recipes/", { method: "POST", body: v }),
    onSuccess: (r) => { invalidate(); toast(`Recette « ${r.nom} » créée : ajoute maintenant ses ingrédients`); onCreated(r.id); },
    onError: (e) => toast(e.message, "error"),
  });
  return <RecipeForm submitLabel="Créer" pending={create.isPending} onSubmit={(v) => create.mutate(v)} onCancel={onCancel} />;
}

function EditRecipe({ recipe, onDeleted }: { recipe: Recipe; onDeleted: () => void }) {
  const invalidate = useInvalidateCatalog();
  const toast = useToast();

  const save = useMutation({
    mutationFn: (v: RecipeInput) => api(`/recipes/${recipe.id}`, { method: "PUT", body: v }),
    onSuccess: () => { invalidate(); toast("Recette enregistrée"); },
    onError: (e) => toast(e.message, "error"),
  });
  const remove = useMutation({
    mutationFn: () => api(`/recipes/${recipe.id}`, { method: "DELETE" }),
    onSuccess: () => { invalidate(); toast(`« ${recipe.nom} » supprimée`); onDeleted(); },
    onError: (e) => toast(e.message, "error"),
  });

  return (
    <div className="space-y-6">
      <RecipeNutrition recipe={recipe} />
      <RecipeIngredients recipe={recipe} />
      <div className="border-t border-slate-200 pt-4">
        <div className="label">Informations</div>
        <RecipeForm key={recipe.id} initial={recipe} submitLabel="Enregistrer" pending={save.isPending} onSubmit={(v) => save.mutate(v)} />
      </div>
      <div className="border-t border-slate-200 pt-4">
        <ConfirmButton label="Supprimer la recette" disabled={remove.isPending} onConfirm={() => remove.mutate()} />
      </div>
    </div>
  );
}

function RecipeNutrition({ recipe }: { recipe: Recipe }) {
  if (!recipe.ingredients.length) return null;
  const m = recipeMacros(recipe);
  const portions = recipe.portions || 1;
  const extras = recipeExtras(recipe);
  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <div className="mb-3 text-xs text-slate-500">Recette entière ({portions} portion(s))</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Calories" value={`${fmt(m.cal)} kcal`} hint={portions > 1 ? `${fmt(m.cal / portions)} / portion` : undefined} />
        <Stat label="Protéines" value={`${fmt(m.prot, 1)} g`} hint={portions > 1 ? `${fmt(m.prot / portions, 1)} / portion` : undefined} />
        <Stat label="Glucides" value={`${fmt(m.gluc, 1)} g`} hint={portions > 1 ? `${fmt(m.gluc / portions, 1)} / portion` : undefined} />
        <Stat label="Lipides" value={`${fmt(m.lip, 1)} g`} hint={portions > 1 ? `${fmt(m.lip / portions, 1)} / portion` : undefined} />
      </div>
      {extras.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-200 pt-3 text-xs text-slate-600">
          {extras.map(([nom, e]) => <span key={nom}>{nom} : <b>{fmt(e.valeur, 2)} {e.unite}</b></span>)}
        </div>
      )}
    </div>
  );
}

function RecipeIngredients({ recipe }: { recipe: Recipe }) {
  const ingredients = useIngredients();
  const invalidate = useInvalidateCatalog();
  const toast = useToast();
  const [ingredientId, setIngredientId] = useState<number | null>(null);
  const [mesure, setMesure] = useState<TypeMesure>("poids");
  const [quantite, setQuantite] = useState("100");
  const ing = ingredientId ? ingredients.byId.get(ingredientId) : undefined;

  const add = useMutation({
    mutationFn: () => api(`/recipes/${recipe.id}/ingredients`, {
      method: "POST",
      body: { ingredient_id: ingredientId, quantite: parseNum(quantite), type_mesure: mesure },
    }),
    onSuccess: () => { invalidate(); toast(`${ing?.nom} ajouté`); },
    onError: (e) => toast(e.message, "error"),
  });
  const remove = useMutation({
    mutationFn: (iid: number) => api(`/recipes/${recipe.id}/ingredients/${iid}`, { method: "DELETE" }),
    onSuccess: invalidate,
    onError: (e) => toast(e.message, "error"),
  });

  function choose(id: number) {
    setIngredientId(id);
    setMesure("poids");
    setQuantite(String(ingredients.byId.get(id)?.quantite_defaut ?? 100));
  }

  return (
    <div>
      <div className="label">Ingrédients</div>
      {recipe.ingredients.length ? (
        <ul className="mb-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {recipe.ingredients.map((ri) => (
            <li key={ri.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="flex-1">{ri.ingredient.nom}</span>
              <span className="text-slate-600">
                {ri.type_mesure === "unite" ? `${fmt(ri.quantite, 1)} unité(s)` : `${fmt(ri.quantite, 1)} ${ri.ingredient.unite}`}
              </span>
              <button className="btn-ghost" aria-label={`Retirer ${ri.ingredient.nom}`} disabled={remove.isPending} onClick={() => remove.mutate(ri.ingredient_id)}>
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-sm text-slate-500">Aucun ingrédient pour l'instant.</p>
      )}

      <form
        className="space-y-3 rounded-xl border border-dashed border-slate-300 p-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          const q = parseNum(quantite);
          if (!ingredientId || !q || q <= 0) return toast("Choisis un ingrédient et une quantité", "error");
          add.mutate();
        }}
      >
        <FoodPicker label="Ajouter un ingrédient" items={ingredients.list} counts={NO_COUNTS} value={ingredientId} onChange={choose} />
        <div className="flex flex-wrap items-end gap-3">
          {ing?.quantite_defaut ? (
            <Segmented
              value={mesure}
              onChange={(m) => { setMesure(m); setQuantite(m === "unite" ? "1" : String(ing.quantite_defaut ?? 100)); }}
              options={[{ value: "poids", label: `Poids (${ing.unite})` }, { value: "unite", label: "Unité" }]}
            />
          ) : null}
          <div className="w-32">
            <Field label={mesure === "unite" ? "Nombre" : `Quantité (${ing?.unite ?? "g"})`}>
              <input className="input" type="number" min={0} step="any" value={quantite} onChange={(e) => setQuantite(e.target.value)} />
            </Field>
          </div>
          <button type="submit" className="btn-secondary" disabled={add.isPending}><Plus className="h-4 w-4" /> Ajouter</button>
        </div>
      </form>
    </div>
  );
}
