import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Check, ClipboardPaste, FileUp, Lock, Plus, RotateCcw, Sparkles, X } from "lucide-react";
import { api } from "../api/client";
import { useIngredients } from "../api/queries";
import type { CreatorIngredient, Ingredient, Recipe, RecipeProposal, TypeMesure } from "../api/types";
import { useCurrentUser } from "../auth/AuthContext";
import { parseNum, useInvalidateCatalog } from "../admin/catalog";
import { CoachText } from "../components/Coach";
import CopyPromptButton from "../components/CopyPrompt";
import FoodPicker from "../components/FoodPicker";
import Modal from "../components/Modal";
import { useToast } from "../components/Toast";
import { Card, Field, PageHeader, Segmented, Spinner } from "../components/ui";
import { fmt } from "../lib/nutrition";

/** Types de recette proposés (plusieurs possibles) : pour donner une idée de la recette visée */
const TYPES = [
  "Petit-déjeuner", "Déjeuner", "Dîner", "Plat principal", "Entrée", "Accompagnement", "Salade", "Soupe", "Bowl",
  "Snack", "Dessert", "Gâteau", "Pâtisserie", "Boisson", "Sauce", "Apéritif", "Batch cooking", "Pique-nique",
];
const NO_COUNTS = new Map<number, number>();

interface Row extends CreatorIngredient {
  key: string;
  /** Quantité saisie (texte : « 1,5 » accepté) */
  q: string;
}

interface Draft {
  nom: string;
  types: string[];
  portions: string;
  temps: string;
  description: string;
  ingredients: Row[];
  consignes: string;
  utiliser_frigo: boolean;
}

const EMPTY: Draft = { nom: "", types: [], portions: "2", temps: "", description: "", ingredients: [], consignes: "", utiliser_frigo: false };
const newKey = () => Math.random().toString(36).slice(2);
const norm = (s: string) => s.toLowerCase().replace(/œ/g, "oe").replace(/æ/g, "ae").normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/** Le brouillon reste sur cet appareil si on quitte l'onglet (rien n'est envoyé tant qu'on ne demande rien). */
function useDraft(userId: number): [Draft, (d: Draft | ((d: Draft) => Draft)) => void] {
  const key = `frigood-createur-${userId}`;
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const saved = localStorage.getItem(key);
      return saved ? { ...EMPTY, ...JSON.parse(saved) } : EMPTY;
    } catch {
      return EMPTY;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(draft)); } catch { /* stockage indisponible : tant pis */ }
  }, [key, draft]);
  return [draft, setDraft];
}

function toPayload(d: Draft) {
  const int = (s: string) => { const n = parseNum(s); return n !== null && n >= 0 ? Math.round(n) : null; };
  return {
    nom: d.nom.trim() || null,
    types: d.types,
    description: d.description.trim() || null,
    portions: int(d.portions) || null,
    temps_preparation: int(d.temps),
    ingredients: d.ingredients.map(({ key: _k, q, ...it }) => ({ ...it, quantite: parseNum(q) })),
    consignes: d.consignes.trim() || null,
    utiliser_frigo: d.utiliser_frigo,
  };
}

/** Poids (g / ml) d'une ligne, si on peut le savoir */
function grams(row: Row, ing: Ingredient | undefined): number | null {
  const q = parseNum(row.q);
  if (!q) return null;
  if (row.type_mesure !== "unite") return q;
  const unit = ing?.quantite_defaut ?? row.nutrition?.quantite_defaut;
  return unit ? q * unit : null;
}

export default function RecipeCreator() {
  const user = useCurrentUser();
  const toast = useToast();
  const invalidate = useInvalidateCatalog();
  const ingredients = useIngredients();
  const [draft, setDraft] = useDraft(user.id);
  const [conseils, setConseils] = useState("");
  const [importing, setImporting] = useState(false);
  const [created, setCreated] = useState<Recipe | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const updateRow = (key: string, patch: Partial<Row>) =>
    setDraft((d) => ({ ...d, ingredients: d.ingredients.map((r) => (r.key === key ? { ...r, ...patch } : r)) }));

  /** La proposition de l'IA remplit le formulaire (on garde les consignes et l'option frigo). */
  function apply(p: RecipeProposal, who: string) {
    setDraft((d) => ({
      ...d,
      nom: p.nom || d.nom,
      types: p.types.length ? p.types : d.types,
      portions: p.portions ? String(p.portions) : d.portions,
      temps: p.temps_preparation !== null ? String(p.temps_preparation) : d.temps,
      description: p.description || d.description,
      ingredients: p.ingredients.length
        ? p.ingredients.map((it) => ({ ...it, key: newKey(), q: it.quantite !== null ? String(it.quantite) : "" }))
        : d.ingredients,
    }));
    setConseils(p.conseils);
    setCreated(null);
    toast(`Proposition ${who} appliquée : vérifie et ajuste, puis « Ajouter la recette »`);
  }

  const claude = useMutation({
    mutationFn: () => api<RecipeProposal>(`/users/${user.id}/recipe_creator/ai`, { method: "POST", body: toPayload(draft) }),
    onSuccess: (p) => apply(p, "de Claude"),
    onError: (e) => toast(e.message, "error"),
  });
  const save = useMutation({
    mutationFn: () => {
      const p = toPayload(draft);
      return api<Recipe>(`/users/${user.id}/recipe_creator/save`, {
        method: "POST",
        body: {
          nom: draft.nom.trim(), description: p.description, categorie: draft.types.join(", ") || null,
          portions: p.portions ?? 1, temps_preparation: p.temps_preparation, ingredients: p.ingredients,
        },
      });
    },
    onSuccess: (r) => {
      invalidate();
      setCreated(r);
      setDraft(EMPTY);
      setConseils("");
      toast(`« ${r.nom} » ajoutée au catalogue`);
    },
    onError: (e) => toast(e.message, "error"),
  });

  // Estimation par portion (ingrédients du catalogue, ou nouveaux avec les valeurs de l'IA)
  const estimate = useMemo(() => {
    const total = { cal: 0, prot: 0, gluc: 0, lip: 0 };
    const unknown: string[] = [];
    for (const r of draft.ingredients) {
      if (!r.par_defaut) continue;
      const ing = r.ingredient_id ? ingredients.byId.get(r.ingredient_id) : undefined;
      const v = ing ?? r.nutrition;
      const g = grams(r, ing);
      if (!v || v.calories === null || g === null) { unknown.push(r.nom); continue; }
      total.cal += (v.calories ?? 0) * g / 100;
      total.prot += (v.proteines ?? 0) * g / 100;
      total.gluc += (v.glucides ?? 0) * g / 100;
      total.lip += (v.lipides ?? 0) * g / 100;
    }
    const n = Math.max(parseNum(draft.portions) ?? 1, 1);
    return { cal: total.cal / n, prot: total.prot / n, gluc: total.gluc / n, lip: total.lip / n, unknown };
  }, [draft.ingredients, draft.portions, ingredients.byId]);

  const busy = claude.isPending || save.isPending;
  const catalogLink = user.is_admin ? "/admin/recettes" : "/catalogue";

  return (
    <div className="space-y-4">
      {importing && <ImportModal onClose={() => setImporting(false)} onApply={(p) => { apply(p, "de l'autre IA"); setImporting(false); }} />}
      <PageHeader
        title="Créateur de recettes"
        subtitle="Donne ce que tu as en tête (tout est facultatif), laisse une IA compléter, puis ajoute la recette au catalogue."
      />

      {created && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <span><Check className="mr-1 inline h-4 w-4" /> <b>« {created.nom} »</b> est dans le catalogue{created.valide ? "" : " (visible par toi en attendant d'être validée)"}.</span>
          <span className="flex gap-2">
            <Link to={catalogLink} className="btn-secondary py-1.5">Voir dans le catalogue</Link>
            <button type="button" className="btn-ghost py-1.5" onClick={() => setCreated(null)}>Nouvelle recette</button>
          </span>
        </div>
      )}

      <Card title="La recette">
        <div className="space-y-3">
          <Field label="Nom">
            <input className="input" value={draft.nom} maxLength={120} onChange={(e) => set("nom", e.target.value)} placeholder="Laisse vide pour que l'IA en trouve un" />
          </Field>
          <div>
            <div className="label">Type de recette</div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Types de recette">
              {TYPES.map((t) => {
                const on = draft.types.includes(t);
                return (
                  <button key={t} type="button" aria-pressed={on}
                    onClick={() => set("types", on ? draft.types.filter((x) => x !== t) : [...draft.types, t])}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${on ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                    {t}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Portions">
              <input className="input" type="number" min={1} max={50} value={draft.portions} onChange={(e) => set("portions", e.target.value)} />
            </Field>
            <Field label="Temps de préparation (min)">
              <input className="input" type="number" min={0} value={draft.temps} onChange={(e) => set("temps", e.target.value)} placeholder="ex. 20" />
            </Field>
          </div>
          <Field label="Description / étapes">
            <textarea className="input min-h-[6rem]" value={draft.description} maxLength={8000} onChange={(e) => set("description", e.target.value)}
              placeholder="Laisse vide pour que l'IA écrive les étapes" />
          </Field>
        </div>
      </Card>

      <Card title="Ingrédients">
        <IngredientRows draft={draft} ingredients={ingredients.byId} onChange={updateRow}
          onRemove={(key) => set("ingredients", draft.ingredients.filter((r) => r.key !== key))} />
        <AddIngredients ingredients={ingredients.list} onAdd={(row) => set("ingredients", [...draft.ingredients, row])} />
        {draft.ingredients.length > 0 && (
          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Par portion ≈ <b>{fmt(estimate.cal)} kcal</b> · P {fmt(estimate.prot, 1)} g · G {fmt(estimate.gluc, 1)} g · L {fmt(estimate.lip, 1)} g
            {estimate.unknown.length > 0 && <span className="text-slate-500"> (sans {estimate.unknown.join(", ")} : valeurs ou quantité inconnues)</span>}
          </p>
        )}
      </Card>

      <Card title="Pour l'IA (facultatif)">
        <div className="space-y-3">
          <Field label="Consignes">
            <textarea className="input min-h-[4rem]" value={draft.consignes} maxLength={2000} onChange={(e) => set("consignes", e.target.value)}
              placeholder="ex. sans four, 20 min max, riche en protéines, pour 4 personnes dont 2 enfants…" />
          </Field>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={draft.utiliser_frigo} onChange={(e) => set("utiliser_frigo", e.target.checked)} />
            Utiliser en priorité ce qu'il y a dans mon frigo (surtout ce qui périme bientôt)
          </label>
        </div>
      </Card>

      {conseils && (
        <Card title="Conseils de l'IA"><CoachText text={conseils} /></Card>
      )}

      <Card>
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <button type="button" className="btn-primary" disabled={busy || !draft.nom.trim()} onClick={() => save.mutate()}
              title={draft.nom.trim() ? undefined : "Donne d'abord un nom à la recette"}>
              <Plus className="h-4 w-4" /> {save.isPending ? "Ajout…" : "Ajouter la recette"}
            </button>
            <button type="button" className="btn-secondary border-violet-200 text-violet-700" disabled={busy || !user.coach_access} onClick={() => claude.mutate()}>
              {user.coach_access ? <Sparkles className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
              {claude.isPending ? "Claude cuisine ta recette…" : "Compléter avec Claude"}
            </button>
          </div>
          {claude.isPending && <Spinner label="Compte jusqu'à une minute…" />}
          <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-slate-200 pt-3">
            <p className="w-full text-xs text-slate-500">
              {user.coach_access ? "Ou avec une autre IA (ChatGPT, Claude.ai, Gemini…) :" : "Claude n'est pas activé pour ton compte : utilise une autre IA (ChatGPT, Claude.ai, Gemini…) :"}{" "}
              copie le texte, colle-le dans l'IA, puis colle sa réponse ici.
            </p>
            <CopyPromptButton
              className="btn-secondary py-1.5 text-sm"
              load={() => api<{ texte: string }>(`/users/${user.id}/recipe_creator/prompt`, { method: "POST", body: toPayload(draft) }).then((x) => x.texte)}
            />
            <button type="button" className="btn-secondary py-1.5 text-sm" onClick={() => setImporting(true)}>
              <ClipboardPaste className="h-4 w-4" /> Coller la réponse de l'IA
            </button>
          </div>
          <button type="button" className="btn-ghost text-xs text-slate-500" disabled={busy}
            onClick={() => { if (window.confirm("Tout effacer dans le créateur ?")) { setDraft(EMPTY); setConseils(""); } }}>
            <RotateCcw className="h-3.5 w-3.5" /> Tout effacer
          </button>
        </div>
      </Card>
    </div>
  );
}

function IngredientRows({ draft, ingredients, onChange, onRemove }: {
  draft: Draft;
  ingredients: Map<number, Ingredient>;
  onChange: (key: string, patch: Partial<Row>) => void;
  onRemove: (key: string) => void;
}) {
  if (!draft.ingredients.length) {
    return <p className="mb-3 text-sm text-slate-500">Aucun ingrédient pour l'instant : ajoute ceux que tu veux, ou laisse l'IA les choisir.</p>;
  }
  return (
    <ul className="mb-4 divide-y divide-slate-100">
      {draft.ingredients.map((r) => {
        const ing = r.ingredient_id ? ingredients.get(r.ingredient_id) : undefined;
        const canUnit = !ing || !!ing.quantite_defaut;
        const unitLabel = r.type_mesure === "unite" ? "unité(s)" : ing?.unite ?? r.unite ?? "g";
        // Téléphone : le nom et ses badges sur une ligne, quantité / unité / option dessous
        return (
          <li key={r.key} className="flex flex-wrap items-center gap-x-2 gap-y-1.5 py-2 text-sm">
            <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
              <span className={`font-medium ${r.par_defaut ? "text-slate-900" : "text-slate-500"}`}>{ing?.nom ?? r.nom}</span>
              {!r.ingredient_id && (
                <span className={`badge ml-1.5 align-middle ${r.nutrition ? "bg-violet-100 text-violet-700" : "bg-amber-100 text-amber-800"}`}
                  title={r.nutrition ? "Sera ajouté au catalogue avec les valeurs nutritionnelles proposées par l'IA" : "Sera ajouté au catalogue sans valeurs nutritionnelles (à compléter)"}>
                  nouveau{r.nutrition ? " · valeurs IA" : ""}
                </span>
              )}
              {!r.par_defaut && <span className="badge ml-1.5 bg-slate-100 align-middle text-slate-500">option</span>}
            </div>
            <input className="input w-20 py-1.5 text-right" inputMode="decimal" value={r.q} aria-label={`Quantité de ${ing?.nom ?? r.nom}`}
              onChange={(e) => onChange(r.key, { q: e.target.value })} placeholder="?" />
            <select className="input w-auto py-1.5" value={r.type_mesure === "unite" ? "unite" : unitLabel}
              aria-label={`Unité de ${ing?.nom ?? r.nom}`}
              onChange={(e) => {
                const v = e.target.value;
                onChange(r.key, v === "unite" ? { type_mesure: "unite" } : { type_mesure: "poids", ...(ing ? {} : { unite: v as "g" | "ml" }) });
              }}>
              {ing ? <option value={ing.unite ?? "g"}>{ing.unite ?? "g"}</option> : <><option value="g">g</option><option value="ml">ml</option></>}
              {canUnit && <option value="unite">unité(s)</option>}
            </select>
            <label className="flex cursor-pointer items-center gap-1 text-xs text-slate-600" title="Ingrédient au choix (non compté par défaut)">
              <input type="checkbox" className="h-3.5 w-3.5 accent-brand-600" checked={!r.par_defaut} onChange={(e) => onChange(r.key, { par_defaut: !e.target.checked })} />
              option
            </label>
            <button type="button" className="btn-ghost px-1.5" aria-label={`Retirer ${ing?.nom ?? r.nom}`} onClick={() => onRemove(r.key)}>
              <X className="h-4 w-4" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Ajout d'un ingrédient du catalogue, ou d'un nouveau (pas encore au catalogue). */
function AddIngredients({ ingredients, onAdd }: { ingredients: Ingredient[]; onAdd: (row: Row) => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<"catalogue" | "nouveau">("catalogue");
  const [ingredientId, setIngredientId] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [mesure, setMesure] = useState<TypeMesure>("poids");
  const [nom, setNom] = useState("");
  const [unite, setUnite] = useState<"g" | "ml" | "unite">("g");
  const ing = ingredientId ? ingredients.find((i) => i.id === ingredientId) : undefined;
  const byName = useMemo(() => new Map(ingredients.map((i) => [norm(i.nom), i])), [ingredients]);

  function add() {
    if (mode === "catalogue") {
      if (!ing) return toast("Choisis un ingrédient", "error");
      onAdd({ key: newKey(), ingredient_id: ing.id, nom: ing.nom, q, quantite: null, type_mesure: mesure, par_defaut: true });
    } else {
      const clean = nom.trim();
      if (!clean) return toast("Donne le nom du nouvel ingrédient", "error");
      const existing = byName.get(norm(clean));
      if (existing) {
        // Déjà au catalogue : on le reprend plutôt que d'en créer un doublon
        onAdd({ key: newKey(), ingredient_id: existing.id, nom: existing.nom, q, quantite: null,
          type_mesure: unite === "unite" && existing.quantite_defaut ? "unite" : "poids", par_defaut: true });
        toast(`« ${existing.nom} » est déjà dans le catalogue : repris tel quel`);
      } else {
        onAdd({ key: newKey(), ingredient_id: null, nom: clean, q, quantite: null,
          type_mesure: unite === "unite" ? "unite" : "poids", unite: unite === "ml" ? "ml" : "g", par_defaut: true, nutrition: null });
      }
      setNom("");
    }
    setQ("");
  }

  return (
    <div className="space-y-3 rounded-xl border border-dashed border-slate-300 p-3">
      <Segmented value={mode} onChange={setMode}
        options={[{ value: "catalogue", label: "Du catalogue" }, { value: "nouveau", label: "Nouvel ingrédient" }]} />
      {mode === "catalogue" ? (
        <>
          <FoodPicker label="Ingrédient" items={ingredients} counts={NO_COUNTS} value={ingredientId}
            onChange={(id) => { setIngredientId(id); setMesure("poids"); }} />
          {ing?.quantite_defaut ? (
            <Segmented value={mesure} onChange={setMesure}
              options={[{ value: "poids", label: `Poids (${ing.unite ?? "g"})` }, { value: "unite", label: "Unité" }]} />
          ) : null}
        </>
      ) : (
        <div className="flex gap-2">
          <input className="input min-w-0 flex-1" value={nom} maxLength={120} onChange={(e) => setNom(e.target.value)}
            placeholder="ex. edamame, sauce soja…" aria-label="Nom du nouvel ingrédient" />
          <select className="input w-auto" value={unite} onChange={(e) => setUnite(e.target.value as "g" | "ml" | "unite")} aria-label="Unité du nouvel ingrédient">
            <option value="g">g</option><option value="ml">ml</option><option value="unite">unité(s)</option>
          </select>
        </div>
      )}
      <div className="flex items-end gap-2">
        <div className="w-36">
          <Field label="Quantité (facultatif)">
            <input className="input" inputMode="decimal" value={q} onChange={(e) => setQ(e.target.value)} placeholder="l'IA peut la choisir" />
          </Field>
        </div>
        <button type="button" className="btn-secondary" onClick={add}><Plus className="h-4 w-4" /> Ajouter</button>
      </div>
    </div>
  );
}

/** Réponse d'une autre IA, collée ou chargée en fichier : relue par le serveur, puis elle remplit le formulaire. */
function ImportModal({ onClose, onApply }: { onClose: () => void; onApply: (p: RecipeProposal) => void }) {
  const user = useCurrentUser();
  const toast = useToast();
  const [text, setText] = useState("");
  const parse = useMutation({
    mutationFn: () => api<RecipeProposal>(`/users/${user.id}/recipe_creator/parse`, { method: "POST", body: { texte: text } }),
    onSuccess: onApply,
    onError: (e) => toast(e.message, "error"),
  });
  return (
    <Modal title="Coller la réponse de l'IA" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">Colle toute la réponse (le bloc JSON), ou charge son fichier. Elle remplit le formulaire : tu pourras tout ajuster avant d'ajouter la recette.</p>
        <textarea className="input min-h-[12rem] font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)}
          aria-label="Réponse de l'IA" placeholder={"```json\n{ \"nom\": \"…\", \"ingredients\": [ … ] }\n```"} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="btn-secondary cursor-pointer">
            <FileUp className="h-4 w-4" /> Charger le fichier
            <input type="file" accept=".json,.txt,application/json,text/plain" className="sr-only"
              onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
          </label>
          <button type="button" className="btn-primary" disabled={!text.trim() || parse.isPending} onClick={() => parse.mutate()}>
            {parse.isPending ? "Lecture…" : "Remplir le formulaire"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
