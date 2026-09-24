import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, FileSpreadsheet, Sparkles, Upload } from "lucide-react";
import { api } from "../api/client";
import type { Ingredient, Nutriment, Recipe } from "../api/types";
import { useToast } from "../components/Toast";
import { Card, ErrorMessage } from "../components/ui";
import { todayISO } from "../lib/dates";
import { parseNum, useInvalidateCatalog } from "./catalog";

type Row = Record<string, unknown>;

const loadXlsx = () => import("xlsx");

const s = (v: unknown): string | null => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());
const n = (v: unknown): number | null => (typeof v === "number" ? v : s(v) === null ? null : parseNum(String(v)));
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

async function fetchCatalog() {
  const [ingredients, recipes, nutriments] = await Promise.all([
    api<Ingredient[]>("/ingredients/"),
    api<Recipe[]>("/recipes/"),
    api<Nutriment[]>("/nutriments/"),
  ]);
  return { ingredients, recipes, nutriments };
}

async function exportAll() {
  const XLSX = await loadXlsx();
  const { ingredients, recipes, nutriments } = await fetchCatalog();
  const wb = XLSX.utils.book_new();
  const sheet = (rows: Row[], name: string, headers: string[]) =>
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows, { header: headers }), name);

  sheet(ingredients.map((i) => ({
    Nom: i.nom, Description: i.description, "Catégorie": i.categorie, Calories: i.calories, "Protéines": i.proteines,
    Glucides: i.glucides, Lipides: i.lipides, "Unité": i.unite, "Quantité défaut": i.quantite_defaut,
    "Conservation (jours)": i.duree_conservation, "Nutri-Score": i.nutriscore?.toUpperCase() ?? null, NOVA: i.nova, "Régime": i.regime,
  })), "Ingrédients", ["Nom", "Description", "Catégorie", "Calories", "Protéines", "Glucides", "Lipides", "Unité", "Quantité défaut", "Conservation (jours)", "Nutri-Score", "NOVA", "Régime"]);

  sheet(recipes.flatMap((r) => {
    const base = { Recette: r.nom, Description: r.description, "Catégorie": r.categorie, Portions: r.portions, "Temps préparation (min)": r.temps_preparation };
    return r.ingredients.length
      ? r.ingredients.map((ri) => ({ ...base, "Ingrédient": ri.ingredient.nom, "Quantité": ri.quantite, "Type mesure": ri.type_mesure, "Unité": ri.ingredient.unite }))
      : [base];
  }), "Recettes", ["Recette", "Description", "Catégorie", "Portions", "Temps préparation (min)", "Ingrédient", "Quantité", "Type mesure", "Unité"]);

  sheet(nutriments.map((x) => ({ Nom: x.nom, "Unité": x.unite })), "Nutriments", ["Nom", "Unité"]);

  sheet(ingredients.flatMap((i) => i.nutriments.map((x) => ({
    "Ingrédient": i.nom, Nutriment: x.nutriment.nom, "Valeur (100g)": x.valeur, "Unité": x.nutriment.unite, Notes: x.notes,
  }))), "Ingrédients Nutriments", ["Ingrédient", "Nutriment", "Valeur (100g)", "Unité", "Notes"]);

  XLSX.writeFile(wb, `frigood_backup_${todayISO()}.xlsx`);
}

interface Result {
  ok: number;
  skipped: string[];
}

interface ImportKind {
  key: string;
  title: string;
  sheet: string;
  columns: string;
  run: (rows: Row[], progress: (done: number) => void) => Promise<Result>;
}

async function tryPost(path: string, body: unknown): Promise<boolean> {
  try {
    await api(path, { method: "POST", body });
    return true;
  } catch {
    return false;
  }
}

const IMPORTS: ImportKind[] = [
  {
    key: "ingredients",
    title: "Ingrédients",
    sheet: "Ingrédients",
    columns: "Nom, Description, Catégorie, Calories, Protéines, Glucides, Lipides, Unité, Quantité défaut, Conservation (jours), Nutri-Score, NOVA, Régime",
    run: async (rows, progress) => {
      const res: Result = { ok: 0, skipped: [] };
      for (const [i, r] of rows.entries()) {
        const nom = s(r["Nom"]);
        if (nom && await tryPost("/ingredients/", {
          nom, description: s(r["Description"]), categorie: s(r["Catégorie"]),
          calories: n(r["Calories"]), proteines: n(r["Protéines"]), glucides: n(r["Glucides"]), lipides: n(r["Lipides"]),
          unite: s(r["Unité"]) ?? "g", quantite_defaut: n(r["Quantité défaut"]),
          duree_conservation: Math.round(n(r["Conservation (jours)"]) ?? 7), source_type: "import",
          nutriscore: s(r["Nutri-Score"]), nova: n(r["NOVA"]), regime: s(r["Régime"]),
        })) res.ok++;
        else res.skipped.push(nom ?? `ligne ${i + 2}`);
        progress(i + 1);
      }
      return res;
    },
  },
  {
    key: "nutriments",
    title: "Nutriments",
    sheet: "Nutriments",
    columns: "Nom, Unité",
    run: async (rows, progress) => {
      const res: Result = { ok: 0, skipped: [] };
      for (const [i, r] of rows.entries()) {
        const nom = s(r["Nom"]);
        if (nom && await tryPost("/nutriments/", { nom, unite: s(r["Unité"]) ?? "g" })) res.ok++;
        else res.skipped.push(nom ?? `ligne ${i + 2}`);
        progress(i + 1);
      }
      return res;
    },
  },
  {
    key: "associations",
    title: "Associations ingrédients / nutriments",
    sheet: "Ingrédients Nutriments",
    columns: "Ingrédient, Nutriment, Valeur (100g), Notes — l'ingrédient et le nutriment doivent déjà exister",
    run: async (rows, progress) => {
      const { ingredients, nutriments } = await fetchCatalog();
      const res: Result = { ok: 0, skipped: [] };
      for (const [i, r] of rows.entries()) {
        const ingNom = s(r["Ingrédient"]) ?? "";
        const nutNom = s(r["Nutriment"]) ?? "";
        const ing = ingredients.find((x) => same(x.nom, ingNom));
        const nut = nutriments.find((x) => same(x.nom, nutNom));
        const valeur = n(r["Valeur (100g)"]);
        if (ing && nut && valeur !== null && await tryPost(`/ingredients/${ing.id}/nutriments/`, { nutriment_id: nut.id, valeur, notes: s(r["Notes"]) })) res.ok++;
        else res.skipped.push(`${ingNom || "?"} / ${nutNom || "?"}`);
        progress(i + 1);
      }
      return res;
    },
  },
  {
    key: "recettes",
    title: "Recettes (avec leurs ingrédients)",
    sheet: "Recettes",
    columns: "Recette, Description, Catégorie, Portions, Temps préparation (min), et si besoin Ingrédient, Quantité, Type mesure (poids / unite) — une ligne par ingrédient",
    run: async (rows, progress) => {
      const { ingredients, recipes } = await fetchCatalog();
      const groups = new Map<string, Row[]>();
      for (const r of rows) {
        const nom = s(r["Recette"]);
        if (nom) groups.set(nom, [...(groups.get(nom) ?? []), r]);
      }
      const res: Result = { ok: 0, skipped: [] };
      let done = 0;
      for (const [nom, lines] of groups) {
        if (recipes.some((x) => same(x.nom, nom))) {
          res.skipped.push(`${nom} (déjà existante)`);
        } else {
          const first = lines[0];
          try {
            const created = await api<Recipe>("/recipes/", {
              method: "POST",
              body: {
                nom, description: s(first["Description"]), categorie: s(first["Catégorie"]),
                portions: Math.max(1, Math.round(n(first["Portions"]) ?? 1)),
                temps_preparation: n(first["Temps préparation (min)"]) ? Math.round(n(first["Temps préparation (min)"])!) : null,
              },
            });
            res.ok++;
            for (const line of lines) {
              const ingNom = s(line["Ingrédient"]);
              if (!ingNom) continue;
              const ing = ingredients.find((x) => same(x.nom, ingNom));
              const q = n(line["Quantité"]);
              const mesure = s(line["Type mesure"])?.toLowerCase().startsWith("unit") ? "unite" : "poids";
              if (!ing || !q || !(await tryPost(`/recipes/${created.id}/ingredients`, { ingredient_id: ing.id, quantite: q, type_mesure: mesure }))) {
                res.skipped.push(`${nom} / ${ingNom}`);
              }
            }
          } catch {
            res.skipped.push(nom);
          }
        }
        done += lines.length;
        progress(done);
      }
      return res;
    },
  },
];

export default function DataAdmin() {
  const toast = useToast();
  const [exporting, setExporting] = useState(false);

  return (
    <div className="space-y-4">
      <Card title="Export">
        <p className="mb-3 text-sm text-slate-500">
          Tout le catalogue dans un fichier Excel : ingrédients, recettes et leurs ingrédients, nutriments et leurs valeurs.
          Les comptes, repas et frigos n'en font pas partie : pour une sauvegarde complète, utilise les sauvegardes de la base Postgres.
        </p>
        <button
          className="btn-primary"
          disabled={exporting}
          onClick={async () => {
            setExporting(true);
            try {
              await exportAll();
            } catch (e) {
              toast(e instanceof Error ? e.message : String(e), "error");
            } finally {
              setExporting(false);
            }
          }}
        >
          <Download className="h-4 w-4" /> {exporting ? "Export…" : "Exporter le catalogue en Excel"}
        </button>
      </Card>

      <EnrichCard />

      <div className="grid gap-4 lg:grid-cols-2">
        {IMPORTS.map((kind) => <ImportCard key={kind.key} kind={kind} />)}
      </div>
    </div>
  );
}

function EnrichCard() {
  const invalidate = useInvalidateCatalog();
  const toast = useToast();
  const [result, setResult] = useState<{ ingredients: number; nutriments_added: number } | null>(null);
  const enrich = useMutation({
    mutationFn: () => api<{ ingredients: number; nutriments_added: number }>("/ingredients/enrich_from_sources", { method: "POST" }),
    onSuccess: (r) => { invalidate(); setResult(r); },
    onError: (e) => toast(e.message, "error"),
  });

  return (
    <Card title={<span className="inline-flex items-center gap-1.5"><Sparkles className="h-4 w-4" /> Compléter depuis OpenFoodFacts</span>}>
      <p className="mb-3 text-sm text-slate-500">
        Relit les données OpenFoodFacts déjà enregistrées pour les ingrédients scannés, sans rien rescanner :
        ajoute le Nutri-Score, le NOVA, le régime et les nutriments manquants (B12, zinc, iode…). Rien n'est écrasé.
      </p>
      <button className="btn-secondary" disabled={enrich.isPending} onClick={() => enrich.mutate()}>
        {enrich.isPending ? "Complétion…" : "Compléter les ingrédients scannés"}
      </button>
      {result && (
        <p className="mt-3 text-sm text-slate-700">
          {result.ingredients} ingrédient(s) complété(s), {result.nutriments_added} nutriment(s) ajouté(s).
        </p>
      )}
    </Card>
  );
}

function ImportCard({ kind }: { kind: ImportKind }) {
  const invalidate = useInvalidateCatalog();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<{ name: string; sheet: string; rows: Row[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [result, setResult] = useState<Result | null>(null);

  async function pick(f: File | undefined) {
    setResult(null);
    setError(null);
    setFile(null);
    if (!f) return;
    try {
      const XLSX = await loadXlsx();
      const wb = XLSX.read(await f.arrayBuffer());
      // Un export complet contient plusieurs onglets : on prend celui du bon nom, sinon le premier
      const sheetName = wb.SheetNames.find((x) => same(x, kind.sheet)) ?? wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json<Row>(wb.Sheets[sheetName], { defval: null });
      setFile({ name: f.name, sheet: sheetName, rows });
    } catch (e) {
      setError(new Error(`Fichier illisible : ${e instanceof Error ? e.message : String(e)}`));
    }
  }

  async function run() {
    if (!file) return;
    setRunning(true);
    setDone(0);
    try {
      setResult(await kind.run(file.rows, setDone));
    } catch (e) {
      setError(e);
    } finally {
      setRunning(false);
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["ingredients"] });
    }
  }

  const headers = file?.rows.length ? Object.keys(file.rows[0]) : [];

  return (
    <Card title={<span className="inline-flex items-center gap-1.5"><FileSpreadsheet className="h-4 w-4" /> Importer : {kind.title}</span>}>
      <p className="mb-3 text-xs text-slate-500">Colonnes : {kind.columns}. Les éléments déjà existants sont ignorés.</p>
      <input
        type="file"
        accept=".xlsx,.xls,.csv"
        className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium hover:file:bg-slate-200"
        onChange={(e) => pick(e.target.files?.[0])}
      />
      <div className="mt-3 space-y-3">
        <ErrorMessage error={error} />
        {file && (
          <>
            <p className="text-sm text-slate-600">
              {file.rows.length} ligne(s) dans l'onglet « {file.sheet} »
            </p>
            {file.rows.length > 0 && (
              <div className="max-h-48 overflow-auto rounded-xl border border-slate-200">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                    <tr>{headers.map((h) => <th key={h} className="whitespace-nowrap px-2 py-1.5">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {file.rows.slice(0, 8).map((r, i) => (
                      <tr key={i}>{headers.map((h) => <td key={h} className="whitespace-nowrap px-2 py-1">{s(r[h]) ?? ""}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button className="btn-primary" disabled={running || !file.rows.length} onClick={run}>
              <Upload className="h-4 w-4" /> {running ? `Import… ${done}/${file.rows.length}` : "Importer"}
            </button>
          </>
        )}
        {result && (
          <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
            <div className="font-medium text-emerald-700">{result.ok} importé(s)</div>
            {result.skipped.length > 0 && (
              <div className="mt-1 text-slate-600">
                Ignoré(s) ({result.skipped.length}) : {result.skipped.slice(0, 15).join(", ")}{result.skipped.length > 15 ? "…" : ""}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
