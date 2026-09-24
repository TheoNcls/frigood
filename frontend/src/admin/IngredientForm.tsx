import { useState, type FormEvent } from "react";
import { AlertTriangle } from "lucide-react";
import { useIngredients } from "../api/queries";
import type { IngredientInput, IngredientSuggestion, NutrimentSuggestion } from "../api/types";
import { Field } from "../components/ui";
import { parseNum } from "./catalog";

const str = (v: number | string | null | undefined) => (v === null || v === undefined ? "" : String(v));

/** Formulaire d'ingrédient, pré-rempli (Claude, OpenFoodFacts, ingrédient existant) ou vide. */
export default function IngredientForm({ initial = {}, currentId, submitLabel, pending, onSubmit, onCancel }: {
  initial?: IngredientSuggestion;
  currentId?: number;
  submitLabel: string;
  pending?: boolean;
  onSubmit: (values: IngredientInput, nutriments: NutrimentSuggestion[]) => void;
  onCancel?: () => void;
}) {
  const ingredients = useIngredients();
  const [f, setF] = useState({
    nom: initial.nom ?? "",
    categorie: initial.categorie ?? "",
    description: initial.description ?? "",
    calories: str(initial.calories),
    proteines: str(initial.proteines),
    glucides: str(initial.glucides),
    lipides: str(initial.lipides),
    unite: initial.unite || "g",
    quantite_defaut: str(initial.quantite_defaut),
    duree_conservation: str(initial.duree_conservation ?? 7),
  });
  const suggested = initial.nutriments ?? [];
  const [nuts, setNuts] = useState(suggested.map((n) => ({ ...n, valeurStr: String(n.valeur), checked: true })));

  const set = (key: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [key]: e.target.value });

  // Suggestions : catégories OpenFoodFacts d'abord, puis celles déjà utilisées dans le catalogue
  const categoryOptions = [...new Set([
    ...(initial.categories ?? []),
    ...ingredients.list.map((i) => i.categorie?.trim()).filter((c): c is string => !!c).sort((a, b) => a.localeCompare(b, "fr")),
  ])];

  const duplicate = ingredients.list.find(
    (i) => i.id !== currentId && i.nom.trim().toLowerCase() === f.nom.trim().toLowerCase(),
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    const qd = parseNum(f.quantite_defaut);
    const duree = parseNum(f.duree_conservation);
    onSubmit(
      {
        nom: f.nom.trim(),
        categorie: f.categorie.trim() || null,
        description: f.description.trim() || null,
        calories: parseNum(f.calories),
        proteines: parseNum(f.proteines),
        glucides: parseNum(f.glucides),
        lipides: parseNum(f.lipides),
        unite: f.unite.trim() || "g",
        quantite_defaut: qd && qd > 0 ? qd : null,
        duree_conservation: duree && duree > 0 ? Math.round(duree) : 7,
      },
      nuts
        .filter((n) => n.checked && parseNum(n.valeurStr) !== null)
        .map((n) => ({ nom: n.nom, unite: n.unite, valeur: parseNum(n.valeurStr)! })),
    );
  }

  const num = (key: keyof typeof f, label: string) => (
    <Field label={label}>
      <input className="input" type="number" min={0} step="any" value={f[key]} onChange={set(key)} />
    </Field>
  );

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nom">
          <input className="input" required value={f.nom} onChange={set("nom")} />
        </Field>
        <Field label="Catégorie" hint={initial.categories?.length ? "Autres catégories proposées dans la liste" : "légume, fruit, céréale, légumineuse…"}>
          <input className="input" list="categorie-options" value={f.categorie} onChange={set("categorie")} />
          <datalist id="categorie-options">
            {categoryOptions.map((c) => <option key={c} value={c} />)}
          </datalist>
        </Field>
      </div>
      {duplicate && (
        <p className="flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle className="h-4 w-4 shrink-0" /> Un ingrédient « {duplicate.nom} » existe déjà.
        </p>
      )}
      <Field label="Description">
        <textarea className="input min-h-[4rem]" value={f.description} onChange={set("description")} />
      </Field>

      <div>
        <div className="label">Valeurs pour 100 g</div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {num("calories", "Calories (kcal)")}
          {num("proteines", "Protéines (g)")}
          {num("glucides", "Glucides (g)")}
          {num("lipides", "Lipides (g)")}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Field label="Unité" hint="g ou cl">
          <input className="input" required value={f.unite} onChange={set("unite")} />
        </Field>
        <Field label="Poids d'une unité" hint="ex. 130 pour une pomme">
          <input className="input" type="number" min={0} step="any" value={f.quantite_defaut} onChange={set("quantite_defaut")} />
        </Field>
        <Field label="Conservation (jours)">
          <input className="input" type="number" min={1} step={1} value={f.duree_conservation} onChange={set("duree_conservation")} />
        </Field>
      </div>

      {nuts.length > 0 && (
        <div>
          <div className="label">Nutriments supplémentaires — décoche ceux à exclure</div>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {nuts.map((n, i) => (
              <li key={n.nom} className="flex items-center gap-3 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand-600"
                  checked={n.checked}
                  onChange={(e) => setNuts(nuts.map((x, j) => (j === i ? { ...x, checked: e.target.checked } : x)))}
                />
                <span className={`flex-1 ${n.checked ? "" : "text-slate-400 line-through"}`}>{n.nom}</span>
                <input
                  className="input w-24 py-1 text-right"
                  type="number"
                  step="any"
                  value={n.valeurStr}
                  disabled={!n.checked}
                  onChange={(e) => setNuts(nuts.map((x, j) => (j === i ? { ...x, valeurStr: e.target.value } : x)))}
                />
                <span className="w-20 whitespace-nowrap text-slate-500">{n.unite} / 100 g</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {onCancel && <button type="button" className="btn-secondary" onClick={onCancel}>Annuler</button>}
        <button type="submit" className="btn-primary" disabled={pending}>{pending ? "Enregistrement…" : submitLabel}</button>
      </div>
    </form>
  );
}
