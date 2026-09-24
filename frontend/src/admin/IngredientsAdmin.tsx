import { useMemo, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Barcode, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { ApiError, api } from "../api/client";
import { useIngredients, useNutriments } from "../api/queries";
import type { Ingredient, IngredientInput, IngredientSuggestion, NutrimentSuggestion } from "../api/types";
import { FoodBadges } from "../components/FoodBadges";
import Modal from "../components/Modal";
import { useToast } from "../components/Toast";
import { Card, ConfirmButton, Empty, ErrorMessage, Field, Segmented, Spinner } from "../components/ui";
import { formatFull } from "../lib/dates";
import { fmt } from "../lib/nutrition";
import BarcodeScanner from "./BarcodeScanner";
import IngredientForm from "./IngredientForm";
import { SOURCE_LABELS, createIngredient, parseNum, useInvalidateCatalog, type SourceType } from "./catalog";

export default function IngredientsAdmin() {
  const ingredients = useIngredients();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return ingredients.list
      .filter((i) => !s || i.nom.toLowerCase().includes(s) || (i.categorie ?? "").toLowerCase().includes(s))
      .sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  }, [ingredients.list, search]);

  const editing = editingId ? ingredients.byId.get(editingId) : undefined;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative min-w-[14rem] flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input className="input pl-9" placeholder="Rechercher un ingrédient…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button className="btn-primary" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" /> Nouvel ingrédient
        </button>
      </div>

      <Card className="overflow-x-auto p-0 sm:p-0">
        {ingredients.isLoading ? <div className="px-4"><Spinner /></div> : ingredients.error ? <div className="p-4"><ErrorMessage error={ingredients.error} /></div> : !rows.length ? (
          <div className="px-4"><Empty>{search ? "Aucun ingrédient ne correspond." : "Aucun ingrédient pour l'instant."}</Empty></div>
        ) : (
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Nom ({rows.length})</th>
                <th className="px-3 py-3 text-right">kcal</th>
                <th className="px-3 py-3 text-right">Prot.</th>
                <th className="px-3 py-3 text-right">Gluc.</th>
                <th className="px-3 py-3 text-right">Lip.</th>
                <th className="px-3 py-3">Unité</th>
                <th className="px-3 py-3 text-right">Conserv.</th>
                <th className="px-3 py-3">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((i) => (
                <tr key={i.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setEditingId(i.id)}>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-slate-900">{i.nom}</div>
                    <div className="text-xs text-slate-500">
                      {[i.categorie, i.nutriments.length ? `${i.nutriments.length} nutriment(s)` : null].filter(Boolean).join(" · ")}
                    </div>
                    <div className="mt-1"><FoodBadges item={i} compact /></div>
                  </td>
                  <td className="px-3 py-2.5 text-right">{i.calories !== null ? fmt(i.calories) : "—"}</td>
                  <td className="px-3 py-2.5 text-right">{i.proteines !== null ? fmt(i.proteines, 1) : "—"}</td>
                  <td className="px-3 py-2.5 text-right">{i.glucides !== null ? fmt(i.glucides, 1) : "—"}</td>
                  <td className="px-3 py-2.5 text-right">{i.lipides !== null ? fmt(i.lipides, 1) : "—"}</td>
                  <td className="px-3 py-2.5 text-slate-600">{i.unite}{i.quantite_defaut ? ` · ${fmt(i.quantite_defaut)} /u` : ""}</td>
                  <td className="px-3 py-2.5 text-right text-slate-600">{i.duree_conservation ? `${i.duree_conservation} j` : "—"}</td>
                  <td className="px-3 py-2.5">
                    {i.sources.map((s) => (
                      <span key={s.id} className="badge mr-1 bg-slate-100 text-slate-600">{SOURCE_LABELS[s.source_type] ?? s.source_type}</span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {adding && (
        <Modal title="Nouvel ingrédient" onClose={() => setAdding(false)} wide>
          <AddIngredient onDone={(id) => { setAdding(false); if (id) setEditingId(id); }} />
        </Modal>
      )}
      {editing && (
        <Modal title={editing.nom} onClose={() => setEditingId(null)} wide>
          <EditIngredient ingredient={editing} onDeleted={() => setEditingId(null)} />
        </Modal>
      )}
    </div>
  );
}

type Mode = "claude" | "barcode" | "manual";

function AddIngredient({ onDone }: { onDone: (createdId?: number) => void }) {
  const [mode, setMode] = useState<Mode>("claude");
  const [suggestion, setSuggestion] = useState<IngredientSuggestion | null>(null);
  const nutriments = useNutriments();
  const invalidate = useInvalidateCatalog();
  const toast = useToast();

  const save = useMutation({
    mutationFn: ({ values, nuts }: { values: IngredientInput; nuts: NutrimentSuggestion[] }) => {
      const type: SourceType = mode === "claude" ? "claude" : mode === "barcode" ? "openfoodfacts" : "manual";
      return createIngredient(values, nuts, { type, codeBarre: suggestion?.code_barre, rawData: suggestion?.raw_data }, nutriments.list);
    },
    onSuccess: ({ ingredient, added }) => {
      invalidate();
      toast(`« ${ingredient.nom} » créé${added ? ` avec ${added} nutriment(s)` : ""} !`);
      onDone();
    },
    onError: (e) => { invalidate(); toast(e.message, "error"); },
  });

  function changeMode(m: Mode) {
    setMode(m);
    setSuggestion(null);
  }

  return (
    <div className="space-y-4">
      <Segmented
        full
        value={mode}
        onChange={changeMode}
        options={[
          { value: "claude", label: <span className="inline-flex items-center gap-1.5"><Sparkles className="h-4 w-4" /> Claude</span> },
          { value: "barcode", label: <span className="inline-flex items-center gap-1.5"><Barcode className="h-4 w-4" /> Code-barre</span> },
          { value: "manual", label: "Manuel" },
        ]}
      />

      {!suggestion && mode === "claude" && <ClaudeLookup onFound={setSuggestion} />}
      {!suggestion && mode === "barcode" && <BarcodeLookup onFound={setSuggestion} onExisting={(id) => onDone(id)} />}

      {(suggestion || mode === "manual") && (
        <>
          {suggestion && (
            <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              ✅ Données trouvées{suggestion.code_barre ? ` pour le code ${suggestion.code_barre}` : ""} : vérifie et corrige si besoin avant de créer.
            </p>
          )}
          <IngredientForm
            key={suggestion?.raw_data ?? mode}
            initial={suggestion ?? {}}
            submitLabel="Créer l'ingrédient"
            pending={save.isPending}
            onSubmit={(values, nuts) => save.mutate({ values, nuts })}
            onCancel={suggestion ? () => setSuggestion(null) : () => onDone()}
          />
        </>
      )}
    </div>
  );
}

function ClaudeLookup({ onFound }: { onFound: (s: IngredientSuggestion) => void }) {
  const [nom, setNom] = useState("");
  const lookup = useMutation({
    mutationFn: (n: string) => api<IngredientSuggestion>("/ingredients/from_claude", { query: { nom: n } }),
    onSuccess: onFound,
  });

  return (
    <form className="space-y-3" onSubmit={(e: FormEvent) => { e.preventDefault(); if (nom.trim()) lookup.mutate(nom.trim()); }}>
      <p className="text-sm text-slate-500">Tape un aliment : Claude cherche ses valeurs nutritionnelles (tables CIQUAL / USDA).</p>
      <div className="flex gap-2">
        <input className="input" autoFocus placeholder="ex. citron, quinoa, yaourt grec…" value={nom} onChange={(e) => setNom(e.target.value)} />
        <button type="submit" className="btn-primary shrink-0" disabled={lookup.isPending || !nom.trim()}>
          {lookup.isPending ? "Recherche…" : "Rechercher"}
        </button>
      </div>
      {lookup.isPending && <Spinner label={`Claude recherche « ${nom} »…`} />}
      <ErrorMessage error={lookup.error} />
    </form>
  );
}

function BarcodeLookup({ onFound, onExisting }: {
  onFound: (s: IngredientSuggestion) => void;
  onExisting: (id: number) => void;
}) {
  const [how, setHow] = useState<"scan" | "type">("scan");
  const [code, setCode] = useState("");
  const [scanKey, setScanKey] = useState(0);
  const [existing, setExisting] = useState<Ingredient | null>(null);
  const lookup = useMutation({
    mutationFn: async (c: string): Promise<{ existing?: Ingredient; suggestion?: IngredientSuggestion }> => {
      // Déjà scanné : inutile d'interroger OpenFoodFacts pour finir sur « existe déjà »
      try {
        return { existing: await api<Ingredient>(`/ingredients/by_barcode/${encodeURIComponent(c)}`) };
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) throw e;
      }
      return { suggestion: await api<IngredientSuggestion>("/ingredients/from_barcode", { query: { code: c } }) };
    },
    onSuccess: (r) => (r.existing ? setExisting(r.existing) : onFound(r.suggestion!)),
  });

  function search(c: string) {
    const clean = c.replace(/\s/g, "");
    setCode(clean);
    setExisting(null);
    if (clean) lookup.mutate(clean);
  }

  function scanAgain() {
    lookup.reset();
    setExisting(null);
    setCode("");
    setScanKey((k) => k + 1);
  }

  if (existing) {
    return (
      <div className="space-y-3">
        <div className="rounded-xl bg-sky-50 px-3 py-3 text-sm text-sky-900">
          <div className="font-medium">Déjà dans le catalogue : {existing.nom}</div>
          <div className="mt-0.5 text-xs text-sky-800">
            Code {code}
            {existing.calories !== null ? ` · ${fmt(existing.calories)} kcal / 100 ${existing.unite === "ml" ? "ml" : "g"}` : ""}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => onExisting(existing.id)}>Ouvrir la fiche</button>
          <button className="btn-secondary" onClick={scanAgain}>Scanner un autre produit</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <Segmented
        value={how}
        onChange={(v) => { setHow(v); lookup.reset(); }}
        options={[{ value: "scan", label: "Scanner" }, { value: "type", label: "Saisir le code" }]}
      />
      {how === "scan" ? (
        lookup.isPending || lookup.isError ? null : <BarcodeScanner key={scanKey} onDetected={search} />
      ) : (
        <form className="flex gap-2" onSubmit={(e: FormEvent) => { e.preventDefault(); search(code); }}>
          <input className="input" inputMode="numeric" autoFocus placeholder="ex. 3017624010701" value={code} onChange={(e) => setCode(e.target.value)} />
          <button type="submit" className="btn-primary shrink-0" disabled={lookup.isPending || !code.trim()}>Rechercher</button>
        </form>
      )}
      {lookup.isPending && <Spinner label={`Recherche du produit ${code} sur OpenFoodFacts…`} />}
      {lookup.isError && (
        <div className="space-y-2">
          <ErrorMessage error={lookup.error} />
          {how === "scan" && (
            <button className="btn-secondary" onClick={scanAgain}>Scanner un autre produit</button>
          )}
        </div>
      )}
    </div>
  );
}

function EditIngredient({ ingredient, onDeleted }: { ingredient: Ingredient; onDeleted: () => void }) {
  const invalidate = useInvalidateCatalog();
  const toast = useToast();

  const save = useMutation({
    mutationFn: (values: IngredientInput) => api(`/ingredients/${ingredient.id}`, { method: "PUT", body: values }),
    onSuccess: () => { invalidate(); toast("Ingrédient enregistré"); },
    onError: (e) => toast(e.message, "error"),
  });

  const remove = useMutation({
    mutationFn: () => api(`/ingredients/${ingredient.id}`, { method: "DELETE" }),
    onSuccess: () => { invalidate(); toast(`« ${ingredient.nom} » supprimé`); onDeleted(); },
    onError: (e) => toast(e.message, "error"),
  });

  return (
    <div className="space-y-6">
      <IngredientForm
        key={ingredient.id}
        initial={{
          nom: ingredient.nom,
          description: ingredient.description,
          categorie: ingredient.categorie,
          calories: ingredient.calories,
          proteines: ingredient.proteines,
          glucides: ingredient.glucides,
          lipides: ingredient.lipides,
          unite: ingredient.unite,
          quantite_defaut: ingredient.quantite_defaut,
          duree_conservation: ingredient.duree_conservation,
          nutriscore: ingredient.nutriscore,
          nova: ingredient.nova,
          regime: ingredient.regime,
        }}
        currentId={ingredient.id}
        submitLabel="Enregistrer"
        pending={save.isPending}
        onSubmit={(values) => save.mutate(values)}
      />
      <IngredientNutriments ingredient={ingredient} />
      {ingredient.sources.length > 0 && (
        <div className="text-xs text-slate-500">
          Source :{" "}
          {ingredient.sources.map((s) => (
            <span key={s.id} className="mr-2">
              {SOURCE_LABELS[s.source_type] ?? s.source_type}
              {s.code_barre ? ` (code ${s.code_barre})` : ""}
              {s.created_at ? `, le ${formatFull(s.created_at)}` : ""}
            </span>
          ))}
        </div>
      )}
      <div className="border-t border-slate-200 pt-4">
        <ConfirmButton label="Supprimer l'ingrédient" disabled={remove.isPending} onConfirm={() => remove.mutate()} />
      </div>
    </div>
  );
}

function IngredientNutriments({ ingredient }: { ingredient: Ingredient }) {
  const nutriments = useNutriments();
  const invalidate = useInvalidateCatalog();
  const toast = useToast();
  const [nutrimentId, setNutrimentId] = useState("");
  const [valeur, setValeur] = useState("");
  const [notes, setNotes] = useState("");

  const add = useMutation({
    mutationFn: () => api(`/ingredients/${ingredient.id}/nutriments/`, {
      method: "POST",
      body: { nutriment_id: Number(nutrimentId), valeur: parseNum(valeur), notes: notes.trim() || null },
    }),
    onSuccess: () => { invalidate(); setValeur(""); setNotes(""); },
    onError: (e) => toast(e.message, "error"),
  });

  const remove = useMutation({
    mutationFn: (nid: number) => api(`/ingredients/${ingredient.id}/nutriments/${nid}`, { method: "DELETE" }),
    onSuccess: invalidate,
    onError: (e) => toast(e.message, "error"),
  });

  const selected = nutriments.list.find((n) => String(n.id) === nutrimentId);

  return (
    <div>
      <div className="label">Nutriments supplémentaires (pour 100 g)</div>
      {ingredient.nutriments.length ? (
        <ul className="mb-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {[...ingredient.nutriments].sort((a, b) => a.nutriment.nom.localeCompare(b.nutriment.nom, "fr")).map((n) => (
            <li key={n.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="flex-1">
                {n.nutriment.nom}
                {n.notes && <span className="block text-xs text-slate-500">{n.notes}</span>}
              </span>
              <span className="font-medium">{fmt(n.valeur, 3)} {n.nutriment.unite}</span>
              <button className="btn-ghost" aria-label={`Retirer ${n.nutriment.nom}`} disabled={remove.isPending} onClick={() => remove.mutate(n.nutriment_id)}>
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-sm text-slate-500">Aucun nutriment supplémentaire.</p>
      )}

      <form
        className="grid grid-cols-2 gap-2 sm:grid-cols-[2fr_1fr_2fr_auto] sm:items-end"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!nutrimentId || parseNum(valeur) === null) return toast("Choisis un nutriment et une valeur", "error");
          add.mutate();
        }}
      >
        <Field label="Nutriment">
          <select className="input" value={nutrimentId} onChange={(e) => setNutrimentId(e.target.value)}>
            <option value="">Choisir…</option>
            {[...nutriments.list].sort((a, b) => a.nom.localeCompare(b.nom, "fr")).map((n) => (
              <option key={n.id} value={n.id}>{n.nom} ({n.unite})</option>
            ))}
          </select>
        </Field>
        <Field label={`Valeur${selected ? ` (${selected.unite})` : ""}`}>
          <input className="input" type="number" min={0} step="any" value={valeur} onChange={(e) => setValeur(e.target.value)} />
        </Field>
        <Field label="Note (optionnel)">
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <button type="submit" className="btn-secondary col-span-2 sm:col-span-1" disabled={add.isPending}>
          <Plus className="h-4 w-4" /> Ajouter
        </button>
      </form>
      <p className="mt-1 text-xs text-slate-500">Si le nutriment est déjà associé, sa valeur est mise à jour.</p>
    </div>
  );
}
