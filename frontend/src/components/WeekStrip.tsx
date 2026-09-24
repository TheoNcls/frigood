import { useMemo, useState } from "react";
import { useActivities, useIngredients, useMealLogs, useRecipes, useTasks } from "../api/queries";
import { addDays, parseISODate, todayISO } from "../lib/dates";
import { logMacros } from "../lib/nutrition";
import DaySummary from "./DaySummary";
import { Card } from "./ui";

const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];

function mondayOf(iso: string): string {
  const d = parseISODate(iso);
  return addDays(iso, -((d.getDay() + 6) % 7));
}

function shortKcal(kcal: number): string {
  return kcal >= 1000 ? `${(kcal / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 1 })}k` : String(Math.round(kcal));
}

interface DayInfo {
  kcal: number;
  meals: number;
  sport: number;
  tasksTodo: number;
  tasksDone: number;
}

/** Semaine en cours et suivante (lundi → dimanche) : repas, sport, tâches et calories ; clic = résumé du jour. */
export default function WeekStrip() {
  const [openedDay, setOpenedDay] = useState<string | null>(null);
  const today = todayISO();
  const monday = mondayOf(today);
  const days = Array.from({ length: 14 }, (_, i) => addDays(monday, i));
  const lastDay = days[13];

  const meals = useMealLogs({ date_from: monday, date_to: today });
  const acts = useActivities({ date_from: monday, date_to: today });
  const tasks = useTasks(monday, lastDay);
  const ingredients = useIngredients();
  const recipes = useRecipes();

  const byDay = useMemo(() => {
    const map = new Map<string, DayInfo>();
    const get = (d: string) => map.get(d) ?? map.set(d, { kcal: 0, meals: 0, sport: 0, tasksTodo: 0, tasksDone: 0 }).get(d)!;
    for (const log of meals.data ?? []) {
      const e = get(log.date);
      e.meals++;
      e.kcal += logMacros(log, ingredients.byId, recipes.byId).cal;
    }
    for (const a of acts.data ?? []) get(a.date).sport++;
    for (const t of tasks.data ?? []) {
      const e = get(t.date);
      if (t.fait) e.tasksDone++;
      else e.tasksTodo++;
    }
    return map;
  }, [meals.data, acts.data, tasks.data, ingredients.byId, recipes.byId]);

  const weeks = [days.slice(0, 7), days.slice(7)];

  return (
    <Card title="Cette semaine et la suivante">
      {openedDay && <DaySummary date={openedDay} onClose={() => setOpenedDay(null)} />}
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
                  onClick={() => setOpenedDay(d)}
                  title="Voir le résumé du jour"
                  className={`flex min-h-[4.25rem] flex-col items-center rounded-xl px-0.5 py-1.5 text-center transition sm:min-h-[4.75rem] ${
                    isToday
                      ? "bg-brand-600 text-white shadow-sm"
                      : isFuture
                        ? "bg-slate-50/60 text-slate-500 hover:bg-violet-50"
                        : "bg-slate-50 text-slate-700 hover:bg-emerald-50"
                  }`}
                >
                  <span className={`text-[10px] font-medium uppercase ${isToday ? "text-emerald-100" : "text-slate-400"}`}>
                    {WEEKDAYS[i]}
                  </span>
                  <span className="text-sm font-semibold leading-tight">{day}</span>
                  <span className="mt-1 flex h-2 items-center gap-0.5">
                    {info?.meals ? <span className={`h-1.5 w-1.5 rounded-full ${isToday ? "bg-white" : "bg-emerald-500"}`} /> : null}
                    {Array.from({ length: Math.min(info?.sport ?? 0, 2) }, (_, k) => (
                      <span key={`s${k}`} className="h-1.5 w-1.5 rounded-full bg-orange-500 ring-1 ring-white/60" />
                    ))}
                    {Array.from({ length: Math.min(info?.tasksTodo ?? 0, 3) }, (_, k) => (
                      <span key={`t${k}`} className="h-1.5 w-1.5 rounded-full bg-violet-600 ring-1 ring-white/60" />
                    ))}
                    {Array.from({ length: Math.min(info?.tasksDone ?? 0, 2) }, (_, k) => (
                      <span key={`d${k}`} className="h-1.5 w-1.5 rounded-full bg-violet-300 ring-1 ring-white/60" />
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
        <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-orange-500" /> Sport</span>
        <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-violet-600" /> Tâche</span>
        <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-violet-300" /> Faite</span>
        <span>· kcal mangées · clic sur un jour pour son résumé et ses tâches</span>
      </div>
    </Card>
  );
}
