import { useMemo, useState, type ReactNode } from "react";
import { useIngredients, useNutriments, useRecipes } from "../api/queries";
import type { Ingredient, MealLog } from "../api/types";
import { useCurrentUser } from "../auth/AuthContext";
import { contributions, dayNutrients, foodsWithout, nutrientDecimals, type FoodPart } from "../lib/nutrients";
import { MOMENT_LABELS, describeLog, fmt, totalMacros } from "../lib/nutrition";
import FoodThumb from "./FoodThumb";
import Modal from "./Modal";
import { MacroTile, Segmented } from "./ui";

/** Une valeur suivie sur la journée : calories, une macro, ou un nutriment choisi dans le profil. */
interface Measure {
  key: string;
  label: string;
  unit: string;
  /** Décimales du détail (les tuiles arrondissent davantage) */
  decimals: number;
  target: number | null;
  per100: (ing: Ingredient) => number | null;
}

/**
 * Nutrition d'un jour : calories, macros et nutriments suivis, chaque tuile ouvrant le classement
 * de ce qui l'apporte ce jour-là (Accueil et Historique).
 */
export default function DayNutritionTiles({ logs, showRemaining, dateLabel }: {
  logs: MealLog[];
  showRemaining: boolean;
  dateLabel: string;
}) {
  const user = useCurrentUser();
  const ingredients = useIngredients();
  const recipes = useRecipes();
  const nutriments = useNutriments();
  const [opened, setOpened] = useState<Measure | null>(null);

  const consumed = totalMacros(logs, ingredients.byId, recipes.byId);
  const day = dayNutrients(logs, ingredients.byId, recipes.byId);
  const macros: (Measure & { value: number })[] = [
    { key: "cal", label: "Calories", unit: "kcal", decimals: 0, target: user.calories_cible, value: consumed.cal, per100: (i) => i.calories },
    { key: "prot", label: "Protéines", unit: "g", decimals: 1, target: user.proteines_cible, value: consumed.prot, per100: (i) => i.proteines },
    { key: "gluc", label: "Glucides", unit: "g", decimals: 1, target: user.glucides_cible, value: consumed.gluc, per100: (i) => i.glucides },
    { key: "lip", label: "Lipides", unit: "g", decimals: 1, target: user.lipides_cible, value: consumed.lip, per100: (i) => i.lipides },
  ];
  const suivis = (user.nutriments_suivis ?? []).flatMap((s) => {
    const n = nutriments.list.find((x) => x.id === s.nutriment_id);
    if (!n) return [];
    const decimals = nutrientDecimals(n.unite, s.cible);
    const measure: Measure = {
      key: `n${n.id}`, label: n.nom, unit: n.unite, decimals: Math.max(decimals, 1), target: s.cible,
      per100: (i) => i.nutriments.find((x) => x.nutriment_id === n.id)?.valeur ?? null,
    };
    return [{ measure, suivi: s, decimals, value: day.amounts.get(n.id) ?? 0, missing: foodsWithout(day.foods, n.id) }];
  });

  return (
    <>
      <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
        {macros.map((m) => (
          <MacroTile
            key={m.key} label={m.label} value={m.value} target={m.target} unit={m.unit}
            showRemaining={showRemaining} onClick={() => setOpened(m)}
          />
        ))}
      </div>
      {suivis.length > 0 && (
        <div className="mt-5 grid grid-cols-2 gap-5 border-t border-slate-100 pt-4 md:grid-cols-4">
          {suivis.map(({ measure, suivi, decimals, value, missing }) => (
            <MacroTile
              key={measure.key}
              label={measure.label}
              value={value}
              target={suivi.cible}
              unit={measure.unit}
              decimals={decimals}
              goal={suivi.sens}
              showRemaining={showRemaining}
              onClick={() => setOpened(measure)}
              note={missing.length ? (
                <span title={`Sans valeur connue : ${missing.map((f) => f.nom).join(", ")}`}>
                  partiel : {missing.length} aliment{missing.length > 1 ? "s" : ""} sans valeur
                </span>
              ) : undefined}
            />
          ))}
        </div>
      )}
      {opened && <Breakdown measure={opened} logs={logs} dateLabel={dateLabel} onClose={() => setOpened(null)} />}
    </>
  );
}

const share = (amount: number, total: number) => {
  const pct = total > 0 ? (amount / total) * 100 : 0;
  return pct > 0 && pct < 1 ? "< 1 %" : `${fmt(pct)} %`;
};

/** Ce qui apporte la valeur ce jour-là, du plus au moins : par plat (repas noté) ou par ingrédient. */
function Breakdown({ measure, logs, dateLabel, onClose }: { measure: Measure; logs: MealLog[]; dateLabel: string; onClose: () => void }) {
  const ingredients = useIngredients();
  const recipes = useRecipes();
  const [view, setView] = useState<"plats" | "ingredients">("plats");
  const { entries, missing } = useMemo(
    () => contributions(logs, ingredients.byId, recipes.byId, measure.per100),
    [logs, ingredients.byId, recipes.byId, measure],
  );
  const total = entries.reduce((s, e) => s + e.amount, 0);
  const { unit, decimals } = measure;
  const value = (a: number) => `${fmt(a, decimals)} ${unit}`;
  const significant = (a: number) => a >= 0.5 * 10 ** -decimals;

  // Par ingrédient : un même aliment mangé dans plusieurs plats est additionné
  const byIngredient = useMemo(() => {
    const m = new Map<number, FoodPart>();
    for (const p of entries.flatMap((e) => e.parts)) {
      const cur = m.get(p.ing.id);
      m.set(p.ing.id, cur ? { ...cur, grams: cur.grams + p.grams, amount: cur.amount + p.amount } : { ...p });
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount);
  }, [entries]);
  const hasDishes = entries.some((e) => e.log.recipe_id);

  const plats = entries.filter((e) => significant(e.amount));
  const ings = byIngredient.filter((p) => significant(p.amount));
  const none = view === "plats"
    ? entries.filter((e) => !significant(e.amount) && e.parts.length).map((e) => describeLog(e.log, ingredients.byId, recipes.byId))
    : byIngredient.filter((p) => !significant(p.amount)).map((p) => p.ing.nom);

  return (
    <Modal title={measure.label} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-slate-500">{dateLabel}</span>
          <span>
            <span className="text-lg font-semibold text-slate-900">{fmt(total, decimals)}</span>
            <span className="text-slate-500">{measure.target ? ` / ${fmt(measure.target, decimals)}` : ""} {unit}</span>
          </span>
        </div>

        {hasDishes && (
          <Segmented
            full
            value={view}
            onChange={setView}
            options={[{ value: "plats", label: "Par plat" }, { value: "ingredients", label: "Par ingrédient" }]}
          />
        )}

        {!logs.length ? (
          <p className="text-slate-500">Aucun repas noté ce jour-là.</p>
        ) : (view === "plats" ? !plats.length : !ings.length) ? (
          <p className="text-slate-500">Aucun aliment de ce jour n'en apporte (ou sa valeur est inconnue).</p>
        ) : (
          <ol className="divide-y divide-slate-100">
            {view === "plats" ? plats.map(({ log, parts, amount }) => {
              const ing = log.ingredient_id ? ingredients.byId.get(log.ingredient_id) : undefined;
              const detail = log.recipe_id ? parts.filter((p) => significant(p.amount)).slice(0, 3) : [];
              return (
                <Row
                  key={log.id}
                  thumb={<FoodThumb nom={ing?.nom ?? recipes.byId.get(log.recipe_id ?? -1)?.nom ?? ""} categorie={ing?.categorie} imageUrl={ing?.image_url} recipe={!!log.recipe_id} />}
                  title={describeLog(log, ingredients.byId, recipes.byId)}
                  sub={<>
                    {MOMENT_LABELS[log.moment] ?? log.moment}
                    {detail.length > 0 && <> · dont {detail.map((p) => `${p.ing.nom} ${value(p.amount)}`).join(", ")}</>}
                  </>}
                  amount={value(amount)}
                  pct={share(amount, total)}
                  width={total > 0 ? amount / total : 0}
                />
              );
            }) : ings.map((p) => (
              <Row
                key={p.ing.id}
                thumb={<FoodThumb nom={p.ing.nom} categorie={p.ing.categorie} imageUrl={p.ing.image_url} />}
                title={p.ing.nom}
                sub={`${fmt(p.grams)} ${p.ing.unite} mangés`}
                amount={value(p.amount)}
                pct={share(p.amount, total)}
                width={total > 0 ? p.amount / total : 0}
              />
            ))}
          </ol>
        )}

        {none.length > 0 && <p className="text-xs text-slate-500">N'en apportent pas : {none.join(", ")}</p>}
        {missing.length > 0 && (
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Valeur inconnue pour {missing.map((f) => f.nom).join(", ")} : le total est partiel. Complète la fiche dans le Catalogue.
          </p>
        )}
      </div>
    </Modal>
  );
}

function Row({ thumb, title, sub, amount, pct, width }: {
  thumb: ReactNode;
  title: string;
  sub: ReactNode;
  amount: string;
  pct: string;
  width: number;
}) {
  return (
    <li className="py-2.5">
      <div className="flex items-center gap-3">
        {thumb}
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-slate-900">{title}</div>
          <div className="text-xs text-slate-500">{sub}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-semibold text-slate-900">{amount}</div>
          <div className="text-xs text-slate-500">{pct}</div>
        </div>
      </div>
      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(width, 1) * 100}%` }} />
      </div>
    </li>
  );
}
