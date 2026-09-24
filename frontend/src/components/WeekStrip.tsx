import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useActivities, useIngredients, useMealLogs, useRecipes } from "../api/queries";
import { addDays, parseISODate, todayISO } from "../lib/dates";
import { logMacros } from "../lib/nutrition";
import { Card } from "./ui";

const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];

function mondayOf(iso: string): string {
  const d = parseISODate(iso);
  return addDays(iso, -((d.getDay() + 6) % 7));
}

function shortKcal(kcal: number): string {
  return kcal >= 1000 ? `${(kcal / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}k` : String(Math.round(kcal));
}

/** Semaine en cours et suivante (lundi → dimanche) : repas, activités et calories de chaque jour. */
export default function WeekStrip() {
  const navigate = useNavigate();
  const today = todayISO();
  const monday = mondayOf(today);
  const days = Array.from({ length: 14 }, (_, i) => addDays(monday, i));

  const meals = useMealLogs({ date_from: monday, date_to: today });
  const acts = useActivities({ date_from: monday, date_to: today });
  const ingredients = useIngredients();
  const recipes = useRecipes();

  const byDay = useMemo(() => {
    const map = new Map<string, { kcal: number; meals: number; garmin: number; manual: number }>();
    const get = (d: string) => map.get(d) ?? map.set(d, { kcal: 0, meals: 0, garmin: 0, manual: 0 }).get(d)!;
    for (const log of meals.data ?? []) {
      const e = get(log.date);
      e.meals++;
      e.kcal += logMacros(log, ingredients.byId, recipes.byId).cal;
    }
    for (const a of acts.data ?? []) {
      const e = get(a.date);
      if (a.source === "garmin") e.garmin++;
      else e.manual++;
    }
    return map;
  }, [meals.data, acts.data, ingredients.byId, recipes.byId]);

  const weeks = [days.slice(0, 7), days.slice(7)];

  return (
    <Card title="Cette semaine et la suivante">
      <div className="space-y-2">
        {weeks.map((week, w) => (
          <div key={w} className="grid grid-cols-7 gap-1 sm:gap-2">
            {week.map((d, i) => {
              const isToday = d === today;
              const isFuture = d > today;
              const info = byDay.get(d);
              const day = parseISODate(d).getDate();
              return (
                <button
                  key={d}
                  type="button"
                  disabled={isFuture}
                  onClick={() => navigate(`/historique?date=${d}`)}
                  title={isFuture ? undefined : "Ouvrir l'historique du jour"}
                  className={`flex min-h-[4.25rem] flex-col items-center rounded-xl px-0.5 py-1.5 text-center transition sm:min-h-[4.75rem] ${
                    isToday
                      ? "bg-brand-600 text-white shadow-sm"
                      : isFuture
                        ? "cursor-default bg-slate-50/60 text-slate-400"
                        : "bg-slate-50 text-slate-700 hover:bg-emerald-50"
                  }`}
                >
                  <span className={`text-[10px] font-medium uppercase ${isToday ? "text-emerald-100" : "text-slate-400"}`}>
                    {WEEKDAYS[i]}
                  </span>
                  <span className="text-sm font-semibold leading-tight">{day}</span>
                  <span className="mt-1 flex h-2 items-center gap-0.5">
                    {info?.meals ? <span className={`h-1.5 w-1.5 rounded-full ${isToday ? "bg-white" : "bg-emerald-500"}`} /> : null}
                    {Array.from({ length: Math.min(info?.garmin ?? 0, 2) }, (_, k) => (
                      <span key={`g${k}`} className="h-1.5 w-1.5 rounded-full bg-orange-500 ring-1 ring-white/60" />
                    ))}
                    {Array.from({ length: Math.min(info?.manual ?? 0, 2) }, (_, k) => (
                      <span key={`m${k}`} className="h-1.5 w-1.5 rounded-full bg-blue-500 ring-1 ring-white/60" />
                    ))}
                  </span>
                  {info?.kcal ? (
                    <span className={`mt-0.5 text-[10px] leading-none ${isToday ? "text-emerald-50" : "text-slate-500"}`}>
                      {shortKcal(info.kcal)}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Repas</span>
        <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-orange-500" /> Activité Garmin</span>
        <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-blue-500" /> Activité manuelle</span>
        <span>· kcal mangées</span>
      </div>
    </Card>
  );
}
