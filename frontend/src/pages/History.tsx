import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  useActivities, useActivityTypes, useDailyStat, useDailyStatsRange, useIngredients, useMealLogs, useRecipes,
} from "../api/queries";
import type { Activity, DailyStat } from "../api/types";
import ActivityDetail from "../components/ActivityDetail";
import { useCurrentUser } from "../auth/AuthContext";
import { Card, Empty, PageHeader, Spinner, Stat } from "../components/ui";
import { activityDetails, activityLabel } from "../lib/activity";
import { addDays, formatLong, formatShort, todayISO } from "../lib/dates";
import { MOMENTS, MOMENT_LABELS, describeLog, fmt, logMacros, totalMacros } from "../lib/nutrition";

export default function History() {
  const today = todayISO();
  // La date est dans l'adresse (?date=AAAA-MM-JJ) : lien depuis le calendrier, bouton retour, rechargement
  const [params, setParams] = useSearchParams();
  const fromUrl = params.get("date");
  const date = fromUrl && /^\d{4}-\d{2}-\d{2}$/.test(fromUrl) && fromUrl <= today ? fromUrl : addDays(today, -1);
  const setDate = (d: string) => setParams({ date: d > today ? today : d }, { replace: true });

  return (
    <div className="space-y-4">
      <PageHeader title="Historique" />

      <div className="flex items-center gap-2">
        <button className="btn-secondary px-3" aria-label="Jour précédent" onClick={() => setDate(addDays(date, -1))}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <input type="date" className="input max-w-[12rem]" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <button className="btn-secondary px-3" aria-label="Jour suivant" disabled={date >= today} onClick={() => setDate(addDays(date, 1))}>
          <ChevronRight className="h-4 w-4" />
        </button>
        <span className="ml-2 hidden text-sm font-medium text-slate-700 sm:inline">{formatLong(date)}</span>
      </div>

      <DayNutrition date={date} />
      <DayActivities date={date} />
      <DayHealth date={date} />
      <Trend endDate={date} />
    </div>
  );
}

function DayNutrition({ date }: { date: string }) {
  const user = useCurrentUser();
  const meals = useMealLogs({ date });
  const ingredients = useIngredients();
  const recipes = useRecipes();

  const logs = [...(meals.data ?? [])].sort((a, b) => MOMENTS.indexOf(a.moment) - MOMENTS.indexOf(b.moment));
  const total = totalMacros(logs, ingredients.byId, recipes.byId);
  const delta = user.calories_cible ? total.cal - user.calories_cible : null;

  return (
    <Card title="Nutrition">
      {meals.isLoading ? <Spinner /> : !logs.length ? <Empty>Aucun repas enregistré.</Empty> : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat
              label="Calories"
              value={`${fmt(total.cal)} kcal`}
              hint={delta !== null && (
                <span className={delta > 0 ? "text-red-600" : "text-emerald-600"}>
                  {delta > 0 ? "+" : ""}{fmt(delta)} vs objectif
                </span>
              )}
            />
            <Stat label="Protéines" value={`${fmt(total.prot, 1)} g`} />
            <Stat label="Glucides" value={`${fmt(total.gluc, 1)} g`} />
            <Stat label="Lipides" value={`${fmt(total.lip, 1)} g`} />
          </div>
          <ul className="divide-y divide-slate-100 text-sm">
            {logs.map((log) => {
              const m = logMacros(log, ingredients.byId, recipes.byId);
              return (
                <li key={log.id} className="flex flex-wrap items-baseline gap-x-3 py-2">
                  <span className="w-14 font-medium text-slate-700">{MOMENT_LABELS[log.moment] ?? log.moment}</span>
                  <span className="min-w-0 flex-1">{log.recipe_id ? "🍽️ " : "🥗 "}{describeLog(log, ingredients.byId, recipes.byId)}</span>
                  <span className="basis-full pl-[4.25rem] text-xs text-slate-500 sm:basis-auto sm:pl-0">
                    {fmt(m.cal)} kcal · P {fmt(m.prot, 1)} · G {fmt(m.gluc, 1)} · L {fmt(m.lip, 1)}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Card>
  );
}

function DayActivities({ date }: { date: string }) {
  const acts = useActivities({ date });
  const types = useActivityTypes();
  const list = acts.data ?? [];
  const totalCal = list.reduce((s, a) => s + (a.calories ?? 0), 0);
  const [opened, setOpened] = useState<Activity | null>(null);

  return (
    <Card title="Activités sportives" action={totalCal > 0 && <span className="text-sm text-slate-500">{fmt(totalCal)} kcal brûlées</span>}>
      {opened && <ActivityDetail activity={opened} onClose={() => setOpened(null)} />}
      {acts.isLoading ? <Spinner /> : !list.length ? <Empty>Aucune activité enregistrée.</Empty> : (
        <ul className="space-y-1 text-sm">
          {list.map((a) => (
            <li key={a.id}>
              <button type="button" className="-mx-2 w-full rounded-xl px-2 py-1 text-left hover:bg-slate-50" onClick={() => setOpened(a)}>
                {a.source === "garmin" ? "⌚" : "✏️"} <span className="font-medium">{activityLabel(a, types.byId)}</span>
                <span className="text-slate-500"> — {activityDetails(a) || "—"}</span>
                <span className="ml-1 text-brand-700">›</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function scoreColor(score: number) {
  if (score >= 80) return "text-emerald-600";
  if (score >= 60) return "text-amber-600";
  return "text-red-600";
}

function Line2({ label, value }: { label: string; value: ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex justify-between gap-2 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-800">{value}</span>
    </div>
  );
}

const h = (v: number | null) => (v ? `${fmt(v, 1)} h` : null);
const n = (v: number | null, suffix = "") => (v !== null && v !== undefined ? `${fmt(v)}${suffix}` : null);

function DayHealth({ date }: { date: string }) {
  const stat = useDailyStat(date);
  const ds: DailyStat | null | undefined = stat.data;

  return (
    <Card title="Santé Garmin">
      {stat.isLoading ? <Spinner /> : !ds ? (
        <Empty>Pas de données Garmin pour cette date. Synchronise depuis la page Sport.</Empty>
      ) : (
        <div className="grid gap-6 md:grid-cols-3">
          <div className="space-y-1.5">
            <div className="text-sm font-semibold text-slate-700">Sommeil</div>
            {ds.sommeil_score !== null && (
              <div className={`text-3xl font-bold ${scoreColor(ds.sommeil_score)}`}>
                {ds.sommeil_score}<span className="text-base font-normal text-slate-500">/100</span>
              </div>
            )}
            <Line2 label="Durée totale" value={h(ds.sommeil_total_h)} />
            <Line2 label="Profond" value={h(ds.sommeil_profond_h)} />
            <Line2 label="Léger" value={h(ds.sommeil_leger_h)} />
            <Line2 label="REM" value={h(ds.sommeil_rem_h)} />
            <Line2 label="Éveillé" value={h(ds.sommeil_eveil_h)} />
            <Line2 label="Coucher" value={ds.heure_coucher} />
            <Line2 label="Réveil" value={ds.heure_reveil} />
          </div>
          <div className="space-y-1.5">
            <div className="text-sm font-semibold text-slate-700">Cœur & énergie</div>
            <Line2 label="BPM repos" value={n(ds.bpm_repos)} />
            <Line2 label="BPM moyen" value={n(ds.bpm_moy)} />
            <Line2 label="BPM min / max" value={ds.bpm_min && ds.bpm_max ? `${ds.bpm_min} / ${ds.bpm_max}` : null} />
            <Line2 label="Stress moyen" value={n(ds.stress_moy, "/100")} />
            <Line2 label="Stress max" value={n(ds.stress_max, "/100")} />
            <Line2 label="Body battery max" value={n(ds.body_battery_max, "/100")} />
            <Line2 label="Body battery min" value={n(ds.body_battery_min, "/100")} />
          </div>
          <div className="space-y-1.5">
            <div className="text-sm font-semibold text-slate-700">Activité & santé</div>
            <Line2 label="Pas" value={ds.steps ? `${fmt(ds.steps)}${ds.steps_goal ? ` / ${fmt(ds.steps_goal)}` : ""}` : null} />
            <Line2 label="Étages" value={n(ds.etages)} />
            <Line2 label="Respiration" value={ds.respiration_moy ? `${fmt(ds.respiration_moy, 1)} /min` : null} />
            <Line2 label="SpO2" value={n(ds.spo2_moy, " %")} />
            <Line2 label="HRV" value={n(ds.hrv_moy, " ms")} />
          </div>
        </div>
      )}
    </Card>
  );
}

function Trend({ endDate }: { endDate: string }) {
  const user = useCurrentUser();
  const from = addDays(endDate, -13);
  const meals = useMealLogs({ date_from: from, date_to: endDate });
  const stats = useDailyStatsRange(from, endDate);
  const ingredients = useIngredients();
  const recipes = useRecipes();

  const data = useMemo(() => {
    const cal = new Map<string, number>();
    for (const log of meals.data ?? []) {
      cal.set(log.date, (cal.get(log.date) ?? 0) + logMacros(log, ingredients.byId, recipes.byId).cal);
    }
    const sleep = new Map((stats.data ?? []).map((s) => [s.date, s.sommeil_score]));
    return Array.from({ length: 14 }, (_, i) => {
      const d = addDays(from, i);
      return { date: formatShort(d), calories: Math.round(cal.get(d) ?? 0), sommeil: sleep.get(d) ?? null };
    });
  }, [meals.data, stats.data, ingredients.byId, recipes.byId, from]);

  return (
    <Card title="Tendance sur 14 jours">
      <div className="h-64 w-full">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
            <YAxis
              yAxisId="cal"
              domain={[0, (max: number) => Math.ceil(Math.max(max, user.calories_cible ?? 0) * 1.1 / 100) * 100]}
              tick={{ fontSize: 11, fill: "#64748b" }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis yAxisId="sleep" orientation="right" domain={[0, 100]} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar yAxisId="cal" dataKey="calories" name="Calories (kcal)" fill="#10b981" radius={[4, 4, 0, 0]} />
            <Line yAxisId="sleep" dataKey="sommeil" name="Score sommeil" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} connectNulls />
            {user.calories_cible ? (
              <ReferenceLine yAxisId="cal" y={user.calories_cible} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: "objectif", fontSize: 10, fill: "#64748b", position: "insideTopLeft" }} />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
