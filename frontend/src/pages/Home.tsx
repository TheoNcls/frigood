import { Link, useSearchParams } from "react-router-dom";
import { OverdueTasks, TodayTasks, UpcomingImportant } from "../components/Tasks";
import DaySummary from "../components/DaySummary";
import WeekStrip from "../components/WeekStrip";
import { AlertTriangle, Footprints } from "lucide-react";
import { useCurrentUser } from "../auth/AuthContext";
import {
  useDailyStat, useFridge, useIngredients, useMealLogs, useRecipes,
} from "../api/queries";
import { Card, MacroTile, ProgressBar } from "../components/ui";
import { formatLong, todayISO } from "../lib/dates";
import { expiryInfo, fridgeItemName } from "../lib/fridge";
import { fmt, totalMacros } from "../lib/nutrition";

export default function Home() {
  const user = useCurrentUser();
  const today = todayISO();

  const ingredients = useIngredients();
  const recipes = useRecipes();
  const meals = useMealLogs({ date: today });
  const statToday = useDailyStat(today);
  const fridge = useFridge();
  // Clic sur une notification de rappel : /?jour=AAAA-MM-JJ ouvre le résumé de ce jour
  const [params, setParams] = useSearchParams();
  const openedDay = /^\d{4}-\d{2}-\d{2}$/.test(params.get("jour") ?? "") ? params.get("jour") : null;

  const consumed = totalMacros(meals.data ?? [], ingredients.byId, recipes.byId);

  const expiring = (fridge.data ?? []).filter((f) => {
    const { days } = expiryInfo(f.date_peremption);
    return days !== null && days <= 2;
  });

  const steps = statToday.data?.steps ?? null;
  const stepsGoal = statToday.data?.steps_goal || 10000;

  return (
    <div className="space-y-4">
      {openedDay && <DaySummary date={openedDay} onClose={() => setParams({}, { replace: true })} />}
      <header>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Bonjour, {user.nom} 👋</h1>
        <p className="mt-1 text-sm text-slate-500">{formatLong(today)}</p>
      </header>

      {user.nutrition_active && expiring.length > 0 && (
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

      <TodayTasks />
      <OverdueTasks />
      <UpcomingImportant />

      {user.nutrition_active && (
        <Card title="Nutrition du jour" action={<Link to="/repas" className="text-sm font-medium text-brand-700">Ajouter un repas →</Link>}>
          <div className="grid grid-cols-2 gap-5 md:grid-cols-4">
            <MacroTile label="Calories" value={consumed.cal} target={user.calories_cible} unit="kcal" showRemaining />
            <MacroTile label="Protéines" value={consumed.prot} target={user.proteines_cible} unit="g" showRemaining />
            <MacroTile label="Glucides" value={consumed.gluc} target={user.glucides_cible} unit="g" showRemaining />
            <MacroTile label="Lipides" value={consumed.lip} target={user.lipides_cible} unit="g" showRemaining />
          </div>
        </Card>
      )}

      <WeekStrip />

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
