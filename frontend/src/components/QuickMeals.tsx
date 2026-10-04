import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Zap } from "lucide-react";
import { api } from "../api/client";
import { useFridge, useIngredients, useMealLogs, useRecipes } from "../api/queries";
import type { MealLog, MealLogCreate, Moment } from "../api/types";
import { useCurrentUser } from "../auth/AuthContext";
import { addDays } from "../lib/dates";
import { MOMENT_LABELS, describeLog } from "../lib/nutrition";
import { useToast } from "./Toast";
import { Card } from "./ui";

const HABIT_DAYS = 30;
const HABIT_MAX = 6;

const MOMENT_HIER: Record<Moment, string> = {
  matin: "Petit-déj d'hier", midi: "Déjeuner d'hier", soir: "Dîner d'hier", snack: "Snack d'hier",
};

/** Ce qu'on recopie d'un repas : même aliment ou recette, même quantité et mesure (pas les notes). */
export function copyOf(log: MealLog, date: string, moment: Moment): MealLogCreate {
  return {
    date, moment,
    recipe_id: log.recipe_id, ingredient_id: log.ingredient_id,
    quantite: log.quantite ?? 1, type_mesure: log.type_mesure,
    notes: null,
  };
}

const habitKey = (l: MealLog) => `${l.recipe_id ? "r" : "i"}${l.recipe_id ?? l.ingredient_id}-${l.quantite}-${l.type_mesure}`;

/** Ajoute un ou plusieurs repas d'un coup (frigo mis à jour pour chacun). */
export function useAddMeals() {
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: async (payloads: MealLogCreate[]) => {
      const fridge: string[] = [];
      for (const p of payloads) {
        const log = await api<MealLog>(`/users/${user.id}/meal_logs/`, { method: "POST", body: p });
        fridge.push(...log.fridge_updates);
      }
      return { count: payloads.length, fridge };
    },
    onSuccess: ({ count, fridge }) => {
      queryClient.invalidateQueries({ queryKey: ["meal_logs"] });
      queryClient.invalidateQueries({ queryKey: ["fridge"] });
      queryClient.invalidateQueries({ queryKey: ["fridge_history"] });
      toast(`${count > 1 ? `${count} aliments ajoutés` : "Repas ajouté"} !${fridge.length ? ` 🧊 Retiré du frigo : ${fridge.join(", ")}` : ""}`);
    },
    onError: (e) => toast(e.message, "error"),
  });
}

/** Raccourcis : copier le même moment d'hier, et les habituels de ce moment (un appui = ajouté). */
export default function QuickMeals({ date, moment }: { date: string; moment: Moment }) {
  const all = useMealLogs();  // même requête que le tri par fréquence : déjà en cache
  const ingredients = useIngredients();
  const recipes = useRecipes();
  const fridge = useFridge();
  const add = useAddMeals();
  // Une recette se mange à partir d'un plat préparé : sans plat au frigo, pas de raccourci
  const dishRecipes = useMemo(() => new Set((fridge.data ?? []).flatMap((f) => (f.recipe_id ? [f.recipe_id] : []))), [fridge.data]);
  const available = (l: MealLog) => !l.recipe_id || dishRecipes.has(l.recipe_id);

  const { yesterday, habits, today } = useMemo(() => {
    const logs = all.data ?? [];
    const hier = addDays(date, -1);
    const since = addDays(date, -HABIT_DAYS);
    const counts = new Map<string, { log: MealLog; n: number }>();
    for (const l of logs) {
      if (l.moment !== moment || l.date >= date || l.date < since) continue;
      const k = habitKey(l);
      const e = counts.get(k);
      if (e) { e.n++; if (l.date > e.log.date) e.log = l; } else counts.set(k, { log: l, n: 1 });
    }
    const todayKeys = new Set(logs.filter((l) => l.date === date && l.moment === moment).map(habitKey));
    return {
      yesterday: logs.filter((l) => l.date === hier && l.moment === moment),
      habits: [...counts.values()].filter((e) => e.n >= 2).sort((a, b) => b.n - a.n).slice(0, HABIT_MAX),
      today: todayKeys,
    };
  }, [all.data, date, moment]);

  if (!yesterday.length && !habits.length) return null;
  const label = (l: MealLog) => describeLog(l, ingredients.byId, recipes.byId);
  // Déjà noté aujourd'hui comme hier : pas de doublon possible
  const sameAsYesterday = yesterday.length > 0 && yesterday.every((l) => today.has(habitKey(l)));
  const copyable = yesterday.filter(available);
  const missing = yesterday.filter((l) => !available(l));

  return (
    <Card title={<span className="inline-flex items-center gap-1.5"><Zap className="h-4 w-4 text-amber-500" /> Raccourcis · {MOMENT_LABELS[moment]}</span>}>
      <div className="space-y-3">
        {sameAsYesterday ? (
          <p className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-500">
            <Copy className="h-4 w-4 shrink-0" /> Déjà noté comme hier ({MOMENT_HIER[moment].toLowerCase()}).
          </p>
        ) : yesterday.length > 0 && !copyable.length ? (
          <p className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-500">
            <Copy className="h-4 w-4 shrink-0" />
            {MOMENT_HIER[moment]} : {missing.map((l) => recipes.byId.get(l.recipe_id!)?.nom ?? "?").join(", ")}, pas de plat préparé au frigo.
          </p>
        ) : yesterday.length > 0 && (
          <button
            type="button"
            className="flex w-full items-start gap-3 rounded-xl border border-brand-100 bg-brand-50/60 px-3 py-2 text-left text-sm hover:bg-brand-50 disabled:opacity-50"
            disabled={add.isPending || !copyable.length}
            onClick={() => add.mutate(copyable.map((l) => copyOf(l, date, moment)))}
          >
            <Copy className="mt-0.5 h-4 w-4 shrink-0 text-brand-700" />
            <span className="min-w-0">
              <span className="block font-medium text-slate-900">
                Comme hier : {MOMENT_HIER[moment]} · {copyable.length} aliment{copyable.length > 1 ? "s" : ""}
              </span>
              <span className="block truncate text-xs text-slate-500">{copyable.map(label).join(" · ")}</span>
              {missing.length > 0 && (
                <span className="block truncate text-xs text-amber-700">
                  Pas de plat préparé au frigo : {missing.map((l) => recipes.byId.get(l.recipe_id!)?.nom ?? "?").join(", ")}
                </span>
              )}
            </span>
          </button>
        )}
        {habits.length > 0 && (
          <div>
            <div className="mb-1.5 text-xs text-slate-500">Tes habituels — un appui pour ajouter :</div>
            <div className="flex flex-wrap gap-1.5">
              {habits.map(({ log, n }) => {
                const done = today.has(habitKey(log));
                const ok = available(log);
                return (
                  <button
                    key={habitKey(log)}
                    type="button"
                    title={ok ? `${n} fois sur ${HABIT_DAYS} jours` : "Pas de plat préparé au frigo"}
                    disabled={add.isPending || !ok}
                    onClick={() => add.mutate([copyOf(log, date, moment)])}
                    className={`rounded-full border px-3 py-1 text-sm transition disabled:opacity-50 ${
                      done ? "border-slate-200 bg-slate-50 text-slate-400" : "border-slate-200 bg-white text-slate-700 hover:border-brand-300 hover:bg-brand-50"
                    }`}
                  >
                    {done ? "✓ " : ok ? "+ " : "🧊 "}{label(log)}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
