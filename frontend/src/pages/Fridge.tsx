import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { api } from "../api/client";
import { useFridge, useFridgeHistory, useIngredients, useRecipes } from "../api/queries";
import type { FridgeItem, TypeMesure } from "../api/types";
import { useCurrentUser } from "../auth/AuthContext";
import FoodPicker from "../components/FoodPicker";
import { useToast } from "../components/Toast";
import { Card, Empty, ErrorMessage, Field, PageHeader, Segmented, Spinner } from "../components/ui";
import { addDays, formatFull, todayISO } from "../lib/dates";
import {
  ACTION_LABELS, DUREE_RECETTE_DEFAUT, EXPIRY_STYLES, expiryInfo, fridgeItemName, fridgeItemQty,
} from "../lib/fridge";
import { fmt } from "../lib/nutrition";
import { useUsageCounts } from "../lib/usage";

type Tab = "contenu" | "ajouter" | "historique";

function useInvalidateFridge() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["fridge"] });
    queryClient.invalidateQueries({ queryKey: ["fridge_history"] });
  };
}

export default function Fridge() {
  const fridge = useFridge();
  const [tab, setTab] = useState<Tab>("contenu");
  const count = fridge.data?.length ?? 0;

  return (
    <div className="space-y-4">
      <PageHeader title="🧊 Mon frigo" />
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: "contenu", label: `Contenu (${count})` },
          { value: "ajouter", label: "Ajouter" },
          { value: "historique", label: "Historique" },
        ]}
      />
      {tab === "contenu" && <Contents onAdd={() => setTab("ajouter")} />}
      {tab === "ajouter" && <AddForm onDone={() => setTab("contenu")} />}
      {tab === "historique" && <HistoryList />}
    </div>
  );
}

function Contents({ onAdd }: { onAdd: () => void }) {
  const fridge = useFridge();
  const ingredients = useIngredients();
  const recipes = useRecipes();
  const [editing, setEditing] = useState<number | null>(null);
  const [removing, setRemoving] = useState<number | null>(null);

  if (fridge.isLoading) return <Spinner />;
  if (fridge.error) return <ErrorMessage error={fridge.error} />;
  const items = fridge.data ?? [];
  if (!items.length) {
    return (
      <Card>
        <Empty>Ton frigo est vide.</Empty>
        <button className="btn-primary" onClick={onAdd}>Ajouter un aliment</button>
      </Card>
    );
  }

  const expired = items.filter((i) => expiryInfo(i.date_peremption).level === "expired").length;
  const urgent = items.filter((i) => expiryInfo(i.date_peremption).level === "urgent").length;

  return (
    <div className="space-y-3">
      {expired > 0 && <div className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{expired} élément(s) périmé(s) ou à consommer aujourd'hui</div>}
      {urgent > 0 && <div className="rounded-xl bg-orange-50 px-4 py-2 text-sm text-orange-700">{urgent} élément(s) à consommer dans les 2 jours</div>}

      <ul className="grid gap-3 md:grid-cols-2">
        {items.map((item) => {
          const exp = expiryInfo(item.date_peremption);
          return (
            <li key={item.id} className="card">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-900">
                    {item.recipe_id ? "🍽️ " : ""}{fridgeItemName(item, ingredients.byId, recipes.byId)}
                  </div>
                  <div className="text-sm text-slate-500">{fridgeItemQty(item, ingredients.byId)}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className={`badge ${EXPIRY_STYLES[exp.level]}`}>{exp.label}</span>
                    {item.date_achat && <span className="text-slate-500">Ajouté le {formatFull(item.date_achat)}</span>}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button className="btn-ghost" aria-label="Modifier" onClick={() => { setEditing(editing === item.id ? null : item.id); setRemoving(null); }}>
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button className="btn-ghost" aria-label="Retirer" onClick={() => { setRemoving(removing === item.id ? null : item.id); setEditing(null); }}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {editing === item.id && <EditPanel item={item} onClose={() => setEditing(null)} />}
              {removing === item.id && <RemovePanel item={item} onClose={() => setRemoving(null)} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EditPanel({ item, onClose }: { item: FridgeItem; onClose: () => void }) {
  const invalidate = useInvalidateFridge();
  const toast = useToast();
  const [quantite, setQuantite] = useState(String(item.quantite));
  const [peremption, setPeremption] = useState(item.date_peremption ?? "");

  const save = useMutation({
    mutationFn: () => {
      const q = parseFloat(quantite);
      if (!Number.isFinite(q) || q <= 0) return api(`/fridge/${item.id}`, { method: "DELETE", query: { raison: "consomme" } });
      return api(`/fridge/${item.id}`, { method: "PUT", body: { quantite: q, date_peremption: peremption || null } });
    },
    onSuccess: () => { invalidate(); onClose(); },
    onError: (e) => toast(e.message, "error"),
  });

  return (
    <form
      className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3"
      onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}
    >
      <Field label="Quantité" hint="0 = consommé entièrement">
        <input className="input" type="number" min={0} step="any" value={quantite} onChange={(e) => setQuantite(e.target.value)} />
      </Field>
      <Field label="Péremption">
        <input className="input" type="date" value={peremption} onChange={(e) => setPeremption(e.target.value)} />
      </Field>
      <div className="col-span-2 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
        <button type="submit" className="btn-primary" disabled={save.isPending}>Enregistrer</button>
      </div>
    </form>
  );
}

const REMOVE_REASONS = [
  { value: "consomme", label: "Consommé" },
  { value: "perime", label: "Périmé / jeté" },
  { value: "suppression", label: "Erreur de saisie (efface de l'historique)" },
] as const;

function RemovePanel({ item, onClose }: { item: FridgeItem; onClose: () => void }) {
  const invalidate = useInvalidateFridge();
  const toast = useToast();
  const remove = useMutation({
    mutationFn: (raison: string) => api(`/fridge/${item.id}`, { method: "DELETE", query: { raison } }),
    onSuccess: () => { invalidate(); onClose(); },
    onError: (e) => toast(e.message, "error"),
  });

  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <div className="mb-2 text-sm text-slate-600">Pourquoi le retirer ?</div>
      <div className="flex flex-wrap gap-2">
        {REMOVE_REASONS.map((r) => (
          <button key={r.value} className="btn-secondary" disabled={remove.isPending} onClick={() => remove.mutate(r.value)}>
            {r.label}
          </button>
        ))}
        <button className="btn-ghost" onClick={onClose}>Annuler</button>
      </div>
    </div>
  );
}

function AddForm({ onDone }: { onDone: () => void }) {
  const user = useCurrentUser();
  const ingredients = useIngredients();
  const recipes = useRecipes();
  const usage = useUsageCounts();
  const invalidate = useInvalidateFridge();
  const toast = useToast();

  const [kind, setKind] = useState<"ingredient" | "recette">("ingredient");
  const [ingredientId, setIngredientId] = useState<number | null>(null);
  const [recipeId, setRecipeId] = useState<number | null>(null);
  const [mesure, setMesure] = useState<TypeMesure>("poids");
  const [quantite, setQuantite] = useState("100");
  const [deduire, setDeduire] = useState(true);
  const [dateAchat, setDateAchat] = useState(todayISO());
  const [peremption, setPeremption] = useState<string | null>(null);

  const ingredient = ingredientId ? ingredients.byId.get(ingredientId) : undefined;
  const recipe = recipeId ? recipes.byId.get(recipeId) : undefined;
  const duree = kind === "recette" ? DUREE_RECETTE_DEFAUT : ingredient?.duree_conservation ?? 7;
  // Tant que l'utilisateur n'a pas choisi de date, la péremption suit la date d'achat + la durée de conservation
  const peremptionEffective = peremption ?? addDays(dateAchat, duree);

  const qNum = parseFloat(quantite) || 0;
  const baseQty = kind === "ingredient" && mesure === "unite" ? qNum * (ingredient?.quantite_defaut ?? 0) : qNum;

  const add = useMutation({
    mutationFn: () => api(`/users/${user.id}/fridge/`, {
      method: "POST",
      body: {
        ingredient_id: kind === "ingredient" ? ingredientId : null,
        recipe_id: kind === "recette" ? recipeId : null,
        quantite: baseQty,
        date_achat: dateAchat,
        date_peremption: peremptionEffective,
        deduire_ingredients: kind === "recette" && deduire,
      },
    }),
    onSuccess: () => {
      invalidate();
      toast(`« ${kind === "recette" ? recipe?.nom : ingredient?.nom} » ajouté au frigo`);
      onDone();
    },
    onError: (e) => toast(e.message, "error"),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (kind === "ingredient" && !ingredientId) return toast("Choisis un ingrédient", "error");
    if (kind === "recette" && !recipeId) return toast("Choisis une recette", "error");
    if (baseQty <= 0) return toast("Indique une quantité positive", "error");
    add.mutate();
  }

  return (
    <Card>
      <form onSubmit={submit} className="max-w-xl space-y-4">
        <Segmented
          value={kind}
          onChange={(k) => { setKind(k); setPeremption(null); setMesure("poids"); setQuantite(k === "recette" ? String(recipe?.portions ?? 1) : String(ingredient?.quantite_defaut ?? 100)); }}
          options={[{ value: "ingredient", label: "Ingrédient" }, { value: "recette", label: "Plat cuisiné (recette)" }]}
        />

        {kind === "ingredient" ? (
          <>
            <FoodPicker
              label="Ingrédient"
              items={ingredients.list}
              counts={usage.ingredients}
              value={ingredientId}
              onChange={(id) => { setIngredientId(id); setPeremption(null); setMesure("poids"); setQuantite(String(ingredients.byId.get(id)?.quantite_defaut ?? 100)); }}
            />
            {ingredient?.quantite_defaut ? (
              <Segmented
                value={mesure}
                onChange={(m) => { setMesure(m); setQuantite(m === "unite" ? "1" : String(ingredient.quantite_defaut ?? 100)); }}
                options={[{ value: "poids", label: `Poids (${ingredient.unite})` }, { value: "unite", label: "Unité" }]}
              />
            ) : null}
            <Field
              label={mesure === "unite" ? "Nombre d'unités" : `Quantité (${ingredient?.unite ?? "g"})`}
              hint={mesure === "unite" && ingredient ? `≈ ${fmt(baseQty)} ${ingredient.unite}` : undefined}
            >
              <input className="input" type="number" min={0} step="any" value={quantite} onChange={(e) => setQuantite(e.target.value)} />
            </Field>
          </>
        ) : (
          <>
            <FoodPicker
              label="Recette"
              items={recipes.list}
              counts={usage.recipes}
              value={recipeId}
              onChange={(id) => { setRecipeId(id); setPeremption(null); setQuantite(String(recipes.byId.get(id)?.portions ?? 1)); }}
            />
            <Field label="Nombre de portions">
              <input className="input" type="number" min={0} step="any" value={quantite} onChange={(e) => setQuantite(e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={deduire} onChange={(e) => setDeduire(e.target.checked)} />
              Je viens de la cuisiner : retirer ses ingrédients du frigo
            </label>
          </>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label={kind === "recette" ? "Date de préparation" : "Date d'achat"}>
            <input className="input" type="date" value={dateAchat} onChange={(e) => e.target.value && setDateAchat(e.target.value)} />
          </Field>
          <Field label="Péremption" hint={`Conservation par défaut : ${duree} jour(s)`}>
            <input className="input" type="date" value={peremptionEffective} onChange={(e) => setPeremption(e.target.value || null)} />
          </Field>
        </div>

        <button type="submit" className="btn-primary w-full" disabled={add.isPending}>Ajouter au frigo</button>
      </form>
    </Card>
  );
}

function HistoryList() {
  const history = useFridgeHistory();
  const ingredients = useIngredients();
  const recipes = useRecipes();

  if (history.isLoading) return <Spinner />;
  if (history.error) return <ErrorMessage error={history.error} />;
  const rows = history.data ?? [];
  if (!rows.length) return <Card><Empty>Aucun mouvement pour l'instant.</Empty></Card>;

  return (
    <Card className="overflow-x-auto p-0 sm:p-0">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3">Action</th>
            <th className="px-4 py-3">Aliment</th>
            <th className="px-4 py-3 text-right">Quantité</th>
            <th className="px-4 py-3">Péremption</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((h) => (
            <tr key={h.id}>
              <td className="whitespace-nowrap px-4 py-2 text-slate-500">{h.created_at ? formatFull(h.created_at) : ""}</td>
              <td className="px-4 py-2">{ACTION_LABELS[h.action] ?? h.action}</td>
              <td className="px-4 py-2">{fridgeItemName(h, ingredients.byId, recipes.byId)}</td>
              <td className={`whitespace-nowrap px-4 py-2 text-right font-medium ${h.quantite >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                {fridgeItemQty(h, ingredients.byId, true)}
              </td>
              <td className="whitespace-nowrap px-4 py-2 text-slate-500">{h.date_peremption ? formatFull(h.date_peremption) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
