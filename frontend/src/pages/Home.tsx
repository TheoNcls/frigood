import { useMemo } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Flame, Footprints, Moon } from "lucide-react";
import { useCurrentUser } from "../auth/AuthContext";
import {
  useActivities, useActivityTypes, useDailyStat, useDailyStatsRange, useFridge, useIngredients, useMealLogs, useRecipes,
} from "../api/queries";
import { Card, Empty, MacroTile, ProgressBar } from "../components/ui";
import { addDays, formatLong, formatShort, todayISO } from "../lib/dates";
import { expiryInfo, fridgeItemName } from "../lib/fridge";
import { fmt, totalMacros } from "../lib/nutrition";
import { activityLabel, activityDetails } from "../lib/activity";

export default function Home() {
  const user = useCurrentUser();
  const today = todayISO();

  const ingredients = useIngredients();
  const recipes = useRecipes();
  const types = useActivityTypes();
  const meals = useMealLogs({ date: today });
  const acts = useActivities({ date_from: addDays(today, -90), date_to: today });
  const statToday = useDailyStat(today);
  const sleep = useDailyStatsRange(addDays(today, -3), addDays(today, -1));
  const fridge = useFridge();

  const consumed = totalMacros(meals.data ?? [], ingredients.byId, recipes.byId);

  const expiring = (fridge.data ?? []).filter((f) => {
    const { days } = expiryInfo(f.date_peremption);
    return days !== null && days <= 2;
  });

  const { actsToday, activeDays, streak } = useMemo(() => {
    const list = acts.data ?? [];
    const dates = new Set(list.map((a) => a.date));
    let active = 0;
    for (let i = 0; i < 7; i++) if (dates.has(addDays(today, -i))) active++;
    let s = 0;
    let d = dates.has(today) ? today : addDays(today, -1);
    while (dates.has(d)) {
      s++;
      d = addDays(d, -1);
    }
    return { actsToday: list.filter((a) => a.date === today), activeDays: active, streak: s };
  }, [acts.data, today]);

  const sleepRows = [...(sleep.data ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  const scores = sleepRows.map((r) => r.sommeil_score).filter((s): s is number => s !== null);
  const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

  const steps = statToday.data?.steps ?? null;
  const stepsGoal = statToday.data?.steps_goal || 10000;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Bonjour, {user.nom} 👋</h1>
        <p className="mt-1 text-sm text-slate-500">{formatLong(today)}</p>
      </header>

      {expiring.length > 0 && (
        <Link to="/frigo" className="flex items-start gap-3 rounded-2xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-800">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <div className="font-semibold">À consommer vite</div>
            <div>
              {expiring.map((f) => `${fridgeItemName(f, ingredients.byId, recipes.byId)} (${expiryInfo(f.date_peremption).label})`).join(" · ")}
            </div>
          </div>
        </Link>
      )}

      <Card title="Nutrition du jour" action={<Link to="/repas" className="text-sm font-medium text-brand-700">Ajouter un repas →</Link>}>
        <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
          <MacroTile label="Calories" value={consumed.cal} target={user.calories_cible} unit="kcal" showRemaining />
          <MacroTile label="Protéines" value={consumed.prot} target={user.proteines_cible} unit="g" showRemaining />
          <MacroTile label="Glucides" value={consumed.gluc} target={user.glucides_cible} unit="g" showRemaining />
          <MacroTile label="Lipides" value={consumed.lip} target={user.lipides_cible} unit="g" showRemaining />
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Sport">
          {actsToday.length ? (
            <ul className="mb-4 space-y-1 text-sm">
              {actsToday.map((a) => (
                <li key={a.id}>
                  ✅ <span className="font-medium">{activityLabel(a, types.byId)}</span>
                  {activityDetails(a, { hr: false }) && <span className="text-slate-500"> — {activityDetails(a, { hr: false })}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-4 text-sm text-slate-500">😴 Pas de sport aujourd'hui</p>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <div className="text-xs text-slate-500">Ratio 7 jours</div>
              <div className="text-lg font-semibold">{activeDays}/7</div>
              <ProgressBar value={activeDays} max={7} />
            </div>
            <div className="space-y-1.5">
              <div className="text-xs text-slate-500">Série</div>
              <div className="flex items-center gap-1 text-lg font-semibold">
                {streak} jour{streak > 1 ? "s" : ""}
                {streak > 0 && <Flame className="h-5 w-5 text-orange-500" />}
              </div>
            </div>
          </div>
        </Card>

        <Card title={<span className="inline-flex items-center gap-1.5"><Moon className="h-4 w-4" /> Sommeil — 3 derniers jours</span>}>
          {sleepRows.length ? (
            <>
              {avgScore !== null && (
                <div className="mb-3">
                  <span className="text-3xl font-bold text-slate-900">{fmt(avgScore)}</span>
                  <span className="text-sm text-slate-500"> /100 en moyenne</span>
                </div>
              )}
              <div className="grid grid-cols-3 gap-3 text-sm">
                {sleepRows.map((r) => (
                  <div key={r.date} className="rounded-xl bg-slate-50 p-2">
                    <div className="font-medium">{formatShort(r.date)}</div>
                    <div className="text-slate-500">Score : {r.sommeil_score ?? "—"}</div>
                    <div className="text-slate-500">{r.sommeil_total_h ? `${fmt(r.sommeil_total_h, 1)} h` : "—"}</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <Empty>Pas encore de données sommeil. Synchronise Garmin depuis la page Sport.</Empty>
          )}
        </Card>
      </div>

      {steps ? (
        <Card title={<span className="inline-flex items-center gap-1.5"><Footprints className="h-4 w-4" /> Pas aujourd'hui</span>}>
          <div className="mb-2 text-sm">
            <span className="text-xl font-semibold">{fmt(steps)}</span>
            <span className="text-slate-500"> / {fmt(stepsGoal)} pas</span>
          </div>
          <ProgressBar value={steps} max={stepsGoal} />
          <div className="mt-1.5 text-xs text-slate-500">
            {steps >= stepsGoal ? "✅ Objectif atteint !" : `${fmt(stepsGoal - steps)} pas restants`}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
