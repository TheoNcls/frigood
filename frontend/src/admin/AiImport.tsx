import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Copy, FileUp } from "lucide-react";
import { useNutriments } from "../api/queries";
import type { GreenScore, IngredientInput, IngredientSuggestion, Nova, NutriScore, Regime } from "../api/types";
import { useToast } from "../components/Toast";
import { fmt } from "../lib/nutrition";
import { createIngredient, useInvalidateCatalog } from "./catalog";

// Nutriments demandés en plus de ceux du catalogue (mêmes noms que l'import OpenFoodFacts) : créés au besoin
const DEFAULT_NUTRIMENTS = [
  ["Fibres", "g"], ["Sucres", "g"], ["Acides gras saturés", "g"], ["Oméga-3", "g"], ["Sel", "g"], ["Calcium", "mg"],
  ["Fer", "mg"], ["Zinc", "mg"], ["Magnésium", "mg"], ["Potassium", "mg"], ["Vitamine C", "mg"], ["Vitamine B12", "µg"],
  ["Vitamine D", "µg"], ["Vitamine B9", "µg"], ["Iode", "µg"], ["Sélénium", "µg"],
].map(([nom, unite]) => ({ nom, unite }));

const REGIMES: Regime[] = ["vegan", "vegetarien", "non_vegetarien", "incertain"];

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

function acceptedNutriments(catalog: { nom: string; unite: string }[]) {
  const seen = new Set(catalog.map((n) => norm(n.nom)));
  return [...catalog, ...DEFAULT_NUTRIMENTS.filter((n) => !seen.has(norm(n.nom)))];
}

/** Texte à coller dans n'importe quelle IA (ChatGPT, Claude, Gemini…) : elle répond dans le format que l'appli lit. */
export function buildAiPrompt(names: string[], nutriments: { nom: string; unite: string }[]): string {
  const list = names.length ? names.map((n) => `- ${n}`).join("\n") : "- [écris ici les aliments, un par ligne]";
  const nuts = acceptedNutriments(nutriments).map((n) => `${n.nom} (${n.unite})`).join(", ");
  return `Donne-moi les valeurs nutritionnelles de ces aliments, pour 100 g (ou pour 100 ml s'il s'agit d'un liquide), d'après les tables officielles (CIQUAL en priorité, sinon USDA) :
${list}

Réponds UNIQUEMENT avec un bloc JSON (tu peux aussi le proposer en fichier frigood-ingredients.json), exactement dans ce format :
{
  "frigood": 1,
  "ingredients": [
    {
      "nom": "nom en français, avec la marque si c'est un produit précis",
      "categorie": "légume, fruit, légumineuse, céréale, produit laitier, matière grasse, boisson…",
      "description": "une courte description",
      "calories": 0,
      "proteines": 0,
      "glucides": 0,
      "lipides": 0,
      "unite": "g ou ml",
      "quantite_defaut": "poids (g) ou volume (ml) d'une unité ou d'une portion typique, ou null",
      "poids_paquet": "poids (g) ou volume (ml) d'un paquet du commerce habituel, ou null (vrac, à la pièce)",
      "duree_conservation": "nombre de jours de conservation après achat",
      "regime": "vegan, vegetarien ou non_vegetarien",
      "nova": "1, 2, 3 ou 4 (degré de transformation), ou null",
      "nutriments": [{ "nom": "Fer", "unite": "mg", "valeur": 0 }]
    }
  ]
}
Les nombres sont des nombres (pas de texte, pas d'unité). Calories en kcal, protéines, glucides et lipides en grammes, tous pour 100 g ou 100 ml.
Dans « nutriments », mets ceux présents en quantité notable, avec exactement ces noms et unités : ${nuts}.`;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v.replace(",", ".")) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) / 1000 : null;
};
const text = (v: unknown, max = 500): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
function extractJson(raw: string): unknown {
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : raw;
  const start = body.search(/[[{]/);
  const end = Math.max(body.lastIndexOf("}"), body.lastIndexOf("]"));
  if (start < 0 || end < start) throw new Error("Aucun bloc JSON trouvé dans la réponse");
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    throw new Error("La réponse n'est pas un JSON valide : recopie bien tout le bloc donné par l'IA");
  }
}

/** Lit la réponse de l'IA (texte collé ou fichier) : la liste des ingrédients, et ce qui a été écarté. */
export function parseAiAnswer(raw: string, known: { nom: string; unite: string }[]): { items: IngredientSuggestion[]; warnings: string[] } {
  const data = extractJson(raw) as Record<string, unknown> | unknown[];
  const list: unknown[] = Array.isArray(data) ? data
    : Array.isArray((data as Record<string, unknown>)?.ingredients) ? (data as { ingredients: unknown[] }).ingredients
      : (data as Record<string, unknown>)?.nom ? [data] : [];
  const knownByName = new Map(acceptedNutriments(known).map((n) => [norm(n.nom), n]));
  const items: IngredientSuggestion[] = [];
  const warnings: string[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const nom = text(e.nom, 120);
    if (!nom) { warnings.push("Un aliment sans nom a été ignoré"); continue; }
    const unknown: string[] = [];
    const nutriments = (Array.isArray(e.nutriments) ? e.nutriments : []).flatMap((n) => {
      const r = n as Record<string, unknown>;
      const k = knownByName.get(norm(String(r?.nom ?? "")));
      const valeur = num(r?.valeur);
      if (!k) { if (r?.nom) unknown.push(String(r.nom)); return []; }
      return valeur === null ? [] : [{ nom: k.nom, unite: k.unite, valeur }];
    });
    if (unknown.length) warnings.push(`${nom} : nutriments inconnus ignorés (${unknown.join(", ")})`);
    const unite = /^(ml|cl|l)$/i.test(String(e.unite ?? "").trim()) ? "ml" : "g";
    const nova = num(e.nova);
    const ns = text(e.nutriscore, 1)?.toLowerCase();
    const regime = text(e.regime, 20) as Regime | null;
    const duree = num(e.duree_conservation);
    items.push({
      nom,
      categorie: text(e.categorie, 80),
      description: text(e.description),
      calories: num(e.calories),
      proteines: num(e.proteines),
      glucides: num(e.glucides),
      lipides: num(e.lipides),
      unite,
      quantite_defaut: num(e.quantite_defaut) || null,
      poids_paquet: num(e.poids_paquet) || null,
      duree_conservation: duree ? Math.round(duree) : 7,
      regime: regime && REGIMES.includes(regime) ? regime : null,
      nova: nova && [1, 2, 3, 4].includes(nova) ? (nova as Nova) : null,
      nutriscore: ns && "abcde".includes(ns) ? (ns as NutriScore) : null,
      composition: text(e.composition, 5000),
      nutriments,
      raw_data: JSON.stringify({ source: "ia_externe", item: e }),
    });
  }
  if (!items.length && !warnings.length) warnings.push("Aucun aliment trouvé dans la réponse");
  return { items, warnings };
}

function toInput(s: IngredientSuggestion): IngredientInput {
  return {
    nom: s.nom ?? "", description: s.description ?? null, categorie: s.categorie ?? null,
    calories: s.calories ?? null, proteines: s.proteines ?? null, glucides: s.glucides ?? null, lipides: s.lipides ?? null,
    unite: s.unite ?? "g", quantite_defaut: s.quantite_defaut ?? null, poids_paquet: s.poids_paquet ?? null,
    duree_conservation: s.duree_conservation ?? 7, nutriscore: s.nutriscore ?? null, greenscore: (s.greenscore ?? null) as GreenScore | null,
    nova: s.nova ?? null, regime: s.regime ?? null, image_url: null, composition: s.composition ?? null,
  };
}

/**
 * Ajout par une IA au choix : l'appli donne le texte à coller dans l'IA, on colle sa réponse (ou on charge son fichier).
 * Un seul aliment : le formulaire est pré-rempli ; plusieurs : aperçu puis création en une fois.
 */
export default function AiImport({ onSingle, onDone }: { onSingle: (s: IngredientSuggestion) => void; onDone: () => void }) {
  const nutriments = useNutriments();
  const invalidate = useInvalidateCatalog();
  const toast = useToast();
  const [names, setNames] = useState("");
  const [answer, setAnswer] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  const [items, setItems] = useState<IngredientSuggestion[] | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const prompt = buildAiPrompt(names.split("\n").map((n) => n.trim()).filter(Boolean), nutriments.list);

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt);
      toast("Texte copié : colle-le dans ton IA");
    } catch {
      setShowPrompt(true);
      toast("Copie impossible ici : sélectionne le texte ci-dessous", "error");
    }
  }

  function read(raw = answer) {
    setError(null);
    try {
      const r = parseAiAnswer(raw, nutriments.list);
      setWarnings(r.warnings);
      if (r.items.length === 1) return onSingle(r.items[0]);
      setItems(r.items);
      setPicked(new Set(r.items.map((_, i) => i)));
    } catch (e) {
      setItems(null);
      setError((e as Error).message);
    }
  }

  async function loadFile(file: File | undefined) {
    if (!file) return;
    const content = await file.text();
    setAnswer(content);
    read(content);
  }

  const createAll = useMutation({
    mutationFn: async () => {
      const done: string[] = [];
      const failed: string[] = [];
      for (const [i, s] of (items ?? []).entries()) {
        if (!picked.has(i)) continue;
        try {
          await createIngredient(toInput(s), s.nutriments ?? [], { type: "ia", rawData: s.raw_data }, [...nutriments.list]);
          done.push(s.nom ?? "");
        } catch (e) {
          failed.push(`${s.nom} : ${(e as Error).message}`);
        }
      }
      return { done, failed };
    },
    onSuccess: ({ done, failed }) => {
      invalidate();
      if (done.length) toast(`${done.length} ingrédient(s) ajouté(s)${failed.length ? `, ${failed.length} refusé(s)` : ""}`);
      if (failed.length) {
        setWarnings(failed);
        setItems((list) => list?.filter((s) => !done.includes(s.nom ?? "")) ?? null);
        setPicked(new Set());
      } else {
        onDone();
      }
    },
  });

  return (
    <div className="space-y-4 text-sm">
      <div>
        <div className="label">1. Les aliments à ajouter (un par ligne)</div>
        <textarea
          className="input min-h-[5rem]"
          value={names}
          onChange={(e) => setNames(e.target.value)}
          placeholder={"tofu ferme\nlentilles vertes cuites\nskyr nature (Siggi's)"}
          aria-label="Aliments à ajouter"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary" onClick={copy}>
            <Copy className="h-4 w-4" /> Copier le texte pour l'IA
          </button>
          <button type="button" className="btn-ghost text-xs" onClick={() => setShowPrompt((v) => !v)}>
            {showPrompt ? "Masquer le texte" : "Voir le texte"}
          </button>
        </div>
        {showPrompt && <textarea readOnly className="input mt-2 min-h-[10rem] font-mono text-xs" value={prompt} aria-label="Texte pour l'IA" onFocus={(e) => e.target.select()} />}
        <p className="mt-1 text-xs text-slate-500">Colle-le dans ChatGPT, Claude, Gemini ou une autre IA, puis récupère sa réponse.</p>
      </div>

      <div>
        <div className="label">2. La réponse de l'IA</div>
        <textarea
          className="input min-h-[7rem] font-mono text-xs"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Colle ici toute la réponse (le bloc JSON)…"
          aria-label="Réponse de l'IA"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary" disabled={!answer.trim()} onClick={() => read()}>Lire la réponse</button>
          <label className="btn-secondary cursor-pointer">
            <FileUp className="h-4 w-4" /> Charger le fichier
            <input type="file" accept=".json,.txt,application/json,text/plain" className="sr-only" onChange={(e) => loadFile(e.target.files?.[0])} />
          </label>
        </div>
      </div>

      {error && <p className="rounded-xl bg-red-50 px-3 py-2 text-red-700">{error}</p>}
      {warnings.length > 0 && (
        <ul className="list-disc space-y-0.5 rounded-xl bg-amber-50 py-2 pl-7 pr-3 text-xs text-amber-900">
          {warnings.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}

      {items && items.length > 1 && (
        <div>
          <div className="label">{items.length} aliments trouvés : décoche ceux à ne pas ajouter</div>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {items.map((s, i) => (
              <li key={i} className="flex items-start gap-2 px-3 py-2">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 accent-brand-600"
                  aria-label={`Ajouter ${s.nom}`}
                  checked={picked.has(i)}
                  onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(i); else n.delete(i); return n; })}
                />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-900">{s.nom}</div>
                  <div className="text-xs text-slate-500">
                    {s.calories !== null && s.calories !== undefined ? `${fmt(s.calories)} kcal` : "kcal ?"} · P {fmt(s.proteines ?? 0, 1)} · G {fmt(s.glucides ?? 0, 1)} · L {fmt(s.lipides ?? 0, 1)} / 100 {s.unite}
                    {s.nutriments?.length ? ` · ${s.nutriments.length} nutriment(s)` : ""}
                    {s.poids_paquet ? ` · paquet ${fmt(s.poids_paquet)} ${s.unite}` : ""}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <button type="button" className="btn-primary mt-3 w-full" disabled={createAll.isPending || !picked.size} onClick={() => createAll.mutate()}>
            {createAll.isPending ? "Ajout…" : `Ajouter les ${picked.size} ingrédient(s)`}
          </button>
        </div>
      )}
    </div>
  );
}
