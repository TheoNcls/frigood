import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Plus } from "lucide-react";
import { useActivities, useActivityTypes, useDailyStat, useIngredients, useMealLogs, useRecipes, useTasks } from "../api/queries";
import type { Activity, TaskOccurrence } from "../api/types";
import { useCurrentUser } from "../auth/AuthContext";
import { activityDetails, activityLabel } from "../lib/activity";
import { formatLong, todayISO } from "../lib/dates";
import { TaskForm, TaskRow } from "./Tasks";
import { MOMENTS, MOMENT_LABELS, describeLog, fmt, logMacros, totalMacros } from "../lib/nutrition";
import ActivityDetail from "./ActivityDetail";
import FoodThumb from "./FoodThumb";
import Modal from "./Modal";
import { Empty, ProgressBar, Spinner } from "./ui";

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Mini({ label, value }: { label: string; value: ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}

/** Résumé rapide d'un jour : repas, activités (cliquables) et santé, avec un lien vers l'historique complet. */
export default function DaySummary({ date, onClose }: { date: string; onClose: () => void }) {
  const user = useCurrentUser();
  const navigate = useNavigate();
  const meals = useMealLogs({ date });
  const acts = useActivities({ date });
  const stat = useDailyStat(date);
  const ingredients = useIngredients();
  const recipes = useRecipes();
  const types = useActivityTypes();
  const tasks = useTasks(date, date);
  const [openedActivity, setOpenedActivity] = useState<Activity | null>(null);
  const [editingTask, setEditingTask] = useState<TaskOccurrence | null>(null);
  const [addingTask, setAddingTask] = useState(false);

  // Une seule fenêtre à la fois : fiche d'activité ou tâche remplacent le résumé, qui revient à leur fermeture
  if (openedActivity) {
    return <ActivityDetail activity={openedActivity} onClose={() => setOpenedActivity(null)} />;
  }
  if (editingTask) return <TaskForm task={editingTask} onClose={() => setEditingTask(null)} />;
  if (addingTask) return <TaskForm date={date} onClose={() => setAddingTask(false)} />;

  const isFuture = date > todayISO();
  const logs = [...(meals.data ?? [])].sort((a, b) => MOMENTS.indexOf(a.moment) - MOMENTS.indexOf(b.moment));
  const total = totalMacros(logs, ingredients.byId, recipes.byId);
  const activities = acts.data ?? [];
  const dayTasks = tasks.data ?? [];
  const ds = stat.data;
  const loading = meals.isLoading || acts.isLoading || tasks.isLoading;

  const tasksSection = (
    <Section
      title="Tâches"
      action={
        <button type="button" className="btn-ghost py-1 text-violet-700" onClick={() => setAddingTask(true)}>
          <Plus className="h-4 w-4" /> Ajouter une tâche
        </button>
      }
    >
      {!dayTasks.length ? <Empty>Aucune tâche ce jour-là.</Empty> : (
        <ul className="space-y-1.5">
          {dayTasks.map((t) => <TaskRow key={`${t.task_id}-${t.date}`} task={t} onEdit={setEditingTask} />)}
        </ul>
      )}
    </Section>
  );

  if (isFuture) {
    return (
      <Modal title={formatLong(date)} onClose={onClose}>
        {tasks.isLoading ? <Spinner /> : tasksSection}
      </Modal>
    );
  }

  return (
    <Modal title={formatLong(date)} onClose={onClose} wide>
      {loading ? <Spinner /> : (
        <div className="space-y-5">
          {tasksSection}
          <Section title="Nutrition">
            {!logs.length ? <Empty>Aucun repas enregistré.</Empty> : (
              <>
                <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {([
                    ["Calories", total.cal, user.calories_cible, "kcal"],
                    ["Protéines", total.prot, user.proteines_cible, "g"],
                    ["Glucides", total.gluc, user.glucides_cible, "g"],
                    ["Lipides", total.lip, user.lipides_cible, "g"],
                  ] as const).map(([label, value, target, unit]) => (
                    <div key={label} className="space-y-1">
                      <div className="text-xs text-slate-500">{label}</div>
                      <div className="text-sm">
                        <span className="font-semibold text-slate-900">{fmt(value)}</span>
                        <span className="text-slate-500">{target ? ` / ${fmt(target)}` : ""} {unit}</span>
                      </div>
                      {target ? <ProgressBar value={value} max={target} over={value > target} /> : null}
                    </div>
                  ))}
                </div>
                <ul className="divide-y divide-slate-100">
                  {logs.map((log) => {
                    const ing = log.ingredient_id ? ingredients.byId.get(log.ingredient_id) : undefined;
                    return (
                      <li key={log.id} className="flex items-center gap-3 py-2 text-sm">
                        <FoodThumb
                          nom={ing?.nom ?? recipes.byId.get(log.recipe_id ?? -1)?.nom ?? ""}
                          categorie={ing?.categorie}
                          imageUrl={ing?.image_url}
                          recipe={!!log.recipe_id}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-slate-900">{describeLog(log, ingredients.byId, recipes.byId)}</div>
                          <div className="text-xs text-slate-500">{MOMENT_LABELS[log.moment] ?? log.moment}</div>
                        </div>
                        <span className="shrink-0 text-xs text-slate-500">{fmt(logMacros(log, ingredients.byId, recipes.byId).cal)} kcal</span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </Section>

          <Section title="Activités">
            {!activities.length ? <Empty>Aucune activité.</Empty> : (
              <ul className="space-y-1">
                {activities.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 rounded-xl bg-slate-50 px-3 py-2 text-left text-sm hover:bg-emerald-50"
                      onClick={() => setOpenedActivity(a)}
                    >
                      <span>{a.source === "garmin" ? "⌚" : "✏️"}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-slate-900">{activityLabel(a, types.byId)}</span>
                        <span className="block truncate text-xs text-slate-500">{activityDetails(a) || "—"}</span>
                      </span>
                      <span className="text-brand-700">›</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {ds && (
            <Section title="Santé Garmin">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Mini label="Sommeil" value={ds.sommeil_total_h ? `${fmt(ds.sommeil_total_h, 1)} h${ds.sommeil_score ? ` · ${ds.sommeil_score}/100` : ""}` : null} />
                <Mini label="Pas" value={ds.steps ? fmt(ds.steps) : null} />
                <Mini label="BPM repos" value={ds.bpm_repos} />
                <Mini label="Body battery" value={ds.body_battery_max ? `${ds.body_battery_min ?? "?"} → ${ds.body_battery_max}` : null} />
                <Mini label="Stress moyen" value={ds.stress_moy !== null ? `${ds.stress_moy}/100` : null} />
                <Mini label="HRV" value={ds.hrv_moy ? `${ds.hrv_moy} ms` : null} />
              </div>
            </Section>
          )}

          <div className="flex justify-end border-t border-slate-100 pt-4">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => { onClose(); navigate(`/historique?date=${date}`); }}
            >
              Voir l'historique complet <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
