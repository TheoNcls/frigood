import { Link, useSearchParams } from "react-router-dom";
import { OverdueTasks, TodayTasks, UpcomingImportant } from "../components/Tasks";
import DaySummary from "../components/DaySummary";
import WeekStrip from "../components/WeekStrip";
import { AlertTriangle, Footprints, Target } from "lucide-react";
import { useCurrentUser } from "../auth/AuthContext";
import { useDailyStat, useFridge, useIngredients, useMealLogs, usePlanMilestone, useRecipes } from "../api/queries";
import type { PlanMilestone } from "../api/types";
import { CoachText } from "../components/Coach";
import DayNutritionTiles from "../components/DayNutrition";
import { Card, ProgressBar } from "../components/ui";
import { formatLong, formatShort, todayISO } from "../lib/dates";
import { expiryInfo, fridgeItemName } from "../lib/fridge";
import { fmt } from "../lib/nutrition";

export default function Home() {
  const user = useCurrentUser();
  const today = todayISO();

  const ingredients = useIngredients();
  const recipes = useRecipes();
  const meals = useMealLogs({ date: today });
  const statToday = useDailyStat(today);
  const milestone = usePlanMilestone();
  const jalon = milestone.data ?? null;
  const fridge = useFridge();
  // Clic sur une notification de rappel : /?jour=AAAA-MM-JJ ouvre le résumé de ce jour
  const [params, setParams] = useSearchParams();
  const openedDay = /^\d{4}-\d{2}-\d{2}$/.test(params.get("jour") ?? "") ? params.get("jour") : null;

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
          <DayNutritionTiles logs={meals.data ?? []} showRemaining dateLabel="Aujourd'hui" />
        </Card>
      )}

      <WeekStrip />

      {steps || jalon ? (
        <Card
          title={<span className="inline-flex items-center gap-1.5"><Target className="h-4 w-4" /> Ma progression</span>}
          action={jalon ? <Link to="/profil#plan" className="text-sm font-medium text-brand-700">Mon plan →</Link> : undefined}
        >
          <div className="space-y-4">
            {jalon && <MilestoneProgress jalon={jalon} />}
            {steps ? (
              <div className={jalon ? "border-t border-slate-100 pt-3" : ""}>
                <div className="mb-2 flex items-center gap-1.5 text-sm">
                  <Footprints className="h-4 w-4 text-slate-400" />
                  <span className="text-xl font-semibold">{fmt(steps)}</span>
                  <span className="text-slate-500"> / {fmt(stepsGoal)} pas aujourd'hui</span>
                </div>
                <ProgressBar value={steps} max={stepsGoal} />
                <div className="mt-1.5 text-xs text-slate-500">
                  {steps >= stepsGoal ? "✅ Objectif atteint !" : `${fmt(stepsGoal - steps)} pas restants`}
                </div>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

/** Jalon (bloc) en cours du plan : où on en est dans le bloc, cette semaine par rapport aux cibles, et son détail. */
function MilestoneProgress({ jalon }: { jalon: PlanMilestone }) {
  const c = jalon.cibles;
  const kmTarget = c.km_semaine_min ?? c.km_semaine_max;
  const kmLabel = c.km_semaine_min !== undefined && c.km_semaine_max !== undefined && c.km_semaine_min !== c.km_semaine_max
    ? `${fmt(c.km_semaine_min)}–${fmt(c.km_semaine_max)}` : kmTarget !== undefined ? fmt(kmTarget) : null;
  const rows: { label: string; value: number; target: number; text: string }[] = [];
  if (kmTarget) rows.push({ label: "Cette semaine", value: jalon.semaine.km, target: kmTarget, text: `${fmt(jalon.semaine.km, 1)} / ${kmLabel} km` });
  if (c.d_plus_semaine) rows.push({ label: "D+ cette semaine", value: jalon.semaine.d_plus_m, target: c.d_plus_semaine, text: `${fmt(jalon.semaine.d_plus_m)} / ${fmt(c.d_plus_semaine)} m` });
  if (c.sortie_longue_km) rows.push({
    label: "Plus longue sortie", value: jalon.plus_longue_sortie.km, target: c.sortie_longue_km,
    text: `${fmt(jalon.plus_longue_sortie.km, 1)} / ${fmt(c.sortie_longue_km, 1)} km${c.sortie_longue_d_plus ? ` · ${fmt(jalon.plus_longue_sortie.d_plus_m)} / ${fmt(c.sortie_longue_d_plus)} m D+` : ""}`,
  });

  // Détail du bloc : tout sauf le volume et la sortie longue, déjà en barres de progression
  const details = jalon.lignes.filter((l) => !rows.length || !/volume|sortie longue/i.test(l));

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="text-sm font-semibold text-slate-900">{jalon.titre}</span>
        <span className="text-xs text-slate-500">jalon {jalon.numero} / {jalon.nombre}</span>
      </div>
      {jalon.statut === "en_cours" ? (
        <div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-violet-500" style={{ width: `${(jalon.jour / jalon.jours) * 100}%` }} />
          </div>
          <div className="mt-1 text-xs text-slate-500">Jour {jalon.jour} sur {jalon.jours} · jusqu'au {formatShort(jalon.fin)}</div>
        </div>
      ) : (
        <div className="text-xs text-slate-500">
          {jalon.statut === "a_venir" ? `Commence le ${formatShort(jalon.debut)}` : `Terminé le ${formatShort(jalon.fin)} : dernier jalon du plan`}
        </div>
      )}
      <div className="text-xs text-slate-500">
        {jalon.sports_comptes
          ? <>Sports comptés : {jalon.sports_comptes.join(", ")}</>
          : <>Sports comptés : {jalon.sports_auto} (par défaut : précise-les dans ton plan avec « Sports comptés »)</>}
      </div>
      {rows.map((r) => (
        <div key={r.label}>
          <div className="mb-1 flex justify-between gap-2 text-sm">
            <span className="text-slate-600">{r.label}</span>
            <span className={`font-medium ${r.value >= r.target ? "text-emerald-700" : "text-slate-800"}`}>
              {r.value >= r.target ? "✓ " : ""}{r.text}
            </span>
          </div>
          <ProgressBar value={r.value} max={r.target} />
        </div>
      ))}
      {details.length > 0 && (
        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <CoachText text={details.map((l) => `- ${l}`).join("\n")} />
        </div>
      )}
    </div>
  );
}
