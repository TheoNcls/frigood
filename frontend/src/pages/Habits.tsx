import { useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Check, Pencil, Plus, Undo2 } from "lucide-react";
import { api } from "../api/client";
import { useHabitLogs, useHabits } from "../api/queries";
import type { DailyRoutine, Habit, HabitLog } from "../api/types";
import { useCurrentUser } from "../auth/AuthContext";
import DailyRoutines, { RoutineFormModal } from "../components/DailyRoutines";
import { DaysPicker, ToggleSwitch, usePushActive } from "../components/HabitInputs";
import { useHabitLogActions } from "../components/HabitsToday";
import Modal from "../components/Modal";
import { useToast } from "../components/Toast";
import { Card, ConfirmButton, Empty, PageHeader, ProgressBar, Segmented, Spinner } from "../components/ui";
import { addDays, parseISODate, todayISO } from "../lib/dates";
import { doneDates, habitLabel, habitStats, isDue, isGoal } from "../lib/habits";

const HISTORY_DAYS = 14;
const GOAL_HISTORY_DAYS = 7;   // objectif par semaine : les oublis ne se rattrapent que sur 7 jours
const STATS_DAYS = 60;         // séries : jusqu'à 60 jours en arrière
const DEFAULT_REMINDER = "19:00";

// Pour démarrer vite : nom et emoji pré-remplis (modifiables)
const SUGGESTIONS = [
  { emoji: "🧘", nom: "Méditation" }, { emoji: "📚", nom: "Lecture" }, { emoji: "🎹", nom: "Piano" },
  { emoji: "🤸", nom: "Étirements" }, { emoji: "💧", nom: "Boire 2 L d'eau" }, { emoji: "✍️", nom: "Journal" },
];

/** Objectif « X fois par semaine » : 1 à 7. */
function GoalPicker({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="grid grid-cols-7 gap-1" role="group" aria-label="Fois par semaine">
      {[1, 2, 3, 4, 5, 6, 7].map((n) => (
        <button
          key={n}
          type="button"
          aria-pressed={n === value}
          onClick={() => onChange(n)}
          className={`rounded-lg py-1.5 text-xs font-semibold transition ${
            n === value ? "bg-brand-600 text-white shadow-sm" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
          }`}
        >
          {n}×
        </button>
      ))}
    </div>
  );
}

function useInvalidateHabits() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["habits"] });
}

/** Création ou modification d'une habitude (fenêtre) : jours précis ou objectif par semaine, et rappel. */
function HabitFormModal({ habit, onClose }: { habit?: Habit; onClose: () => void }) {
  const user = useCurrentUser();
  const toast = useToast();
  const invalidate = useInvalidateHabits();
  const pushActive = usePushActive();
  const [nom, setNom] = useState(habit?.nom ?? "");
  const [emoji, setEmoji] = useState(habit?.emoji ?? "");
  const [mode, setMode] = useState<"jours" | "objectif">(habit && isGoal(habit) ? "objectif" : "jours");
  const [jours, setJours] = useState<number[]>(habit?.jours ?? [0, 1, 2, 3, 4, 5, 6]);
  const [goal, setGoal] = useState(habit?.objectif_semaine ?? 3);
  const [reminder, setReminder] = useState(!!habit?.rappel_heure);
  const [heure, setHeure] = useState(habit?.rappel_heure ?? DEFAULT_REMINDER);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        nom: nom.trim(), emoji: emoji.trim() || null, jours,
        objectif_semaine: mode === "objectif" ? goal : null,
        rappel_heure: reminder && heure ? heure : null,
      };
      return habit
        ? api<Habit>(`/habits/${habit.id}`, { method: "PUT", body })
        : api<Habit>(`/users/${user.id}/habits/`, { method: "POST", body });
    },
    onSuccess: (h) => {
      invalidate();
      toast(habit ? `${habitLabel(h)} enregistrée` : `${habitLabel(h)} ajoutée`);
      onClose();
    },
    onError: (e) => toast(e.message, "error"),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (nom.trim()) save.mutate(); };

  return (
    <Modal title={habit ? "Modifier l'habitude" : "Nouvelle habitude"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {!habit && (
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button key={s.nom} type="button" className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-200"
                onClick={() => { setNom(s.nom); setEmoji(s.emoji); }}>
                {s.emoji} {s.nom}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input className="input w-14 text-center" value={emoji} maxLength={8} onChange={(e) => setEmoji(e.target.value)}
            placeholder="🙂" aria-label="Emoji (facultatif)" />
          <input className="input min-w-0 flex-1" value={nom} maxLength={80} onChange={(e) => setNom(e.target.value)}
            placeholder="Piano, méditation, lecture…" aria-label="Nom de l'habitude" />
        </div>

        <div className="space-y-2">
          <Segmented
            full
            value={mode}
            onChange={setMode}
            options={[{ value: "jours", label: "Jours précis" }, { value: "objectif", label: "Objectif par semaine" }]}
          />
          {mode === "jours" ? (
            <DaysPicker value={jours} onChange={setJours} />
          ) : (
            <>
              <GoalPicker value={goal} onChange={setGoal} />
              <p className="text-xs text-slate-500">
                {goal} fois par semaine, les jours que tu veux : proposée chaque jour sur l'accueil jusqu'à ce que l'objectif soit atteint.
              </p>
            </>
          )}
        </div>

        <div className="space-y-2 rounded-xl bg-slate-50 px-3 py-2.5">
          <label className="flex cursor-pointer items-center justify-between gap-3 text-sm font-medium text-slate-800">
            <span className="inline-flex items-center gap-1.5"><Bell className="h-4 w-4 text-slate-500" /> Rappel par notification</span>
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={reminder} onChange={(e) => setReminder(e.target.checked)}
              aria-label="Rappel par notification" />
          </label>
          {reminder && (
            <>
              <input type="time" className="input w-32" value={heure} onChange={(e) => setHeure(e.target.value)} aria-label="Heure du rappel" />
              <p className="text-xs text-slate-500">
                Les jours où elle est à faire, si elle n'est pas encore cochée.
                {pushActive === false && <span className="text-amber-700"> Notifications pas activées sur cet appareil : active-les dans le Profil.</span>}
              </p>
            </>
          )}
        </div>

        <button type="submit" className="btn-primary w-full" disabled={!nom.trim() || (reminder && !heure) || save.isPending}>
          {habit ? <><Check className="h-4 w-4" /> Enregistrer</> : <><Plus className="h-4 w-4" /> Ajouter l'habitude</>}
        </button>
      </form>
    </Modal>
  );
}

function HabitRow({ habit, done, today, oldest, onEdit }: {
  habit: Habit;
  done: Set<string>;
  today: string;
  oldest: string;
  onEdit: () => void;
}) {
  const toast = useToast();
  const invalidate = useInvalidateHabits();
  const stats = habitStats(habit, done, today, oldest);
  const goal = isGoal(habit);
  const update = useMutation({
    mutationFn: (body: Partial<Pick<Habit, "jours" | "active">>) => api<Habit>(`/habits/${habit.id}`, { method: "PUT", body }),
    onSuccess: (h, body) => {
      invalidate();
      if (body.active !== undefined) toast(h.active ? `${habitLabel(h)} reprise` : `${habitLabel(h)} en pause`);
    },
    onError: (e) => toast(e.message, "error"),
  });
  const remove = useMutation({
    mutationFn: () => api(`/habits/${habit.id}`, { method: "DELETE" }),
    onSuccess: () => { invalidate(); toast(`${habitLabel(habit)} supprimée`); },
    onError: (e) => toast(e.message, "error"),
  });

  return (
    <li className={`space-y-2 py-3 ${habit.active ? "" : "opacity-60"}`}>
      <div className="flex items-start justify-between gap-3">
        <button type="button" className="group flex min-w-0 flex-wrap items-center gap-1.5 text-left" onClick={onEdit} aria-label={`Modifier ${habit.nom}`}>
          <span className="truncate font-medium text-slate-900">{habitLabel(habit)}</span>
          {habit.rappel_heure && (
            <span className="badge inline-flex items-center gap-0.5 bg-slate-100 text-slate-600"><Bell className="h-3 w-3" /> {habit.rappel_heure}</span>
          )}
          {!habit.active && <span className="badge bg-slate-200 text-slate-600">en pause</span>}
          <Pencil className="h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-slate-500" />
        </button>
        <ToggleSwitch label={`${habit.nom} active`} checked={habit.active} disabled={update.isPending}
          onChange={(active) => update.mutate({ active })} />
      </div>
      {goal ? (
        <div className="space-y-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-slate-600">Objectif : {habit.objectif_semaine} fois par semaine</span>
            <span className={`font-semibold ${stats.faites >= stats.prevues ? "text-emerald-700" : "text-slate-800"}`}>
              {stats.faites >= stats.prevues ? "✓ " : ""}{stats.faites}/{stats.prevues}
            </span>
          </div>
          <ProgressBar value={stats.faites} max={stats.prevues} />
        </div>
      ) : (
        <DaysPicker value={habit.jours} onChange={(jours) => update.mutate({ jours })} disabled={update.isPending} />
      )}
      <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
        <span>
          {goal ? (stats.faites >= stats.prevues ? "Objectif de la semaine atteint" : `Encore ${stats.prevues - stats.faites} cette semaine`)
            : stats.prevues || stats.faites ? <>Cette semaine : <b className="text-slate-700">{stats.faites}/{stats.prevues}</b></>
              : "Rien de prévu d'ici dimanche"}
          {stats.serie > 1 && (goal
            ? <> · <b className="text-slate-700">{stats.serie}</b> semaines d'affilée 🔥</>
            : <> · série de <b className="text-slate-700">{stats.serie}</b> 🔥</>)}
        </span>
        <ConfirmButton compact label="Supprimer l'habitude et son historique" confirmLabel="Supprimer" disabled={remove.isPending}
          onConfirm={() => remove.mutate()} />
      </div>
    </li>
  );
}

const dayTitle = (iso: string, today: string) =>
  iso === today ? "Aujourd'hui" : iso === addDays(today, -1) ? "Hier"
    : parseISODate(iso).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });

/** Les 14 derniers jours : ce qui a été fait (annulable) et ce qui était à faire (à cocher si oublié). */
function History({ habits, logs, today }: { habits: Habit[]; logs: HabitLog[]; today: string }) {
  const { mark, undo } = useHabitLogActions();
  const byId = new Map(habits.map((h) => [h.id, h]));
  const doneBy = new Map(habits.map((h) => [h.id, doneDates(logs, h.id)]));
  const days = Array.from({ length: HISTORY_DAYS }, (_, i) => addDays(today, -i));
  const rows = days.map((d, i) => {
    const done = logs.filter((l) => l.date === d && byId.has(l.habit_id));
    const doneIds = new Set(done.map((l) => l.habit_id));
    const missed = habits.filter((h) => !doneIds.has(h.id) && (!isGoal(h) || i < GOAL_HISTORY_DAYS) && isDue(h, d, doneBy.get(h.id)!));
    return { d, done, missed };
  }).filter((r) => r.done.length || r.missed.length);

  if (!rows.length) return <Empty>Rien pour l'instant : coche tes habitudes depuis l'accueil.</Empty>;
  return (
    <ul className="space-y-3">
      {rows.map(({ d, done, missed }) => (
        <li key={d}>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{dayTitle(d, today)}</div>
          <div className="flex flex-wrap gap-1.5">
            {done.map((l) => (
              <span key={l.id} className="inline-flex items-center gap-1 rounded-full bg-emerald-50 py-1 pl-2.5 pr-1 text-sm text-emerald-800">
                <Check className="h-3.5 w-3.5" /> {habitLabel(byId.get(l.habit_id)!)}
                <button type="button" className="ml-0.5 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs text-emerald-700 hover:bg-emerald-100 disabled:opacity-40"
                  disabled={l.id < 0} onClick={() => undo.mutate(l)} aria-label={`Annuler ${byId.get(l.habit_id)!.nom}`}>
                  <Undo2 className="h-3 w-3" /> Annuler
                </button>
              </span>
            ))}
            {missed.map((h) => (
              <button key={h.id} type="button" className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-2.5 py-1 text-sm text-slate-500 hover:border-emerald-400 hover:text-emerald-700"
                onClick={() => mark.mutate({ habit: h, date: d })} aria-label={`Marquer ${h.nom} fait le ${d}`}>
                {habitLabel(h)} <span className="text-xs">· marquer fait</span>
              </button>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function Habits() {
  const today = todayISO();
  const oldest = addDays(today, -(STATS_DAYS - 1));
  const habits = useHabits();
  const logs = useHabitLogs(oldest, today);
  const [editing, setEditing] = useState<Habit | "new" | null>(null);
  const [editingRoutine, setEditingRoutine] = useState<DailyRoutine | "new" | null>(null);
  // Onglet dans l'adresse : le lien d'une notification ou un rechargement y ramène
  const [params, setParams] = useSearchParams();
  const tab = params.get("onglet") === "journalieres" ? "journalieres" : "habitudes";
  const setTab = (t: "habitudes" | "journalieres") => setParams(t === "journalieres" ? { onglet: t } : {}, { replace: true });

  const doneBy = useMemo(() => new Map(habits.list.map((h) => [h.id, doneDates(logs.data, h.id)])), [habits.list, logs.data]);
  // Actives d'abord, celles en pause plus bas
  const list = [...habits.list].sort((a, b) => Number(b.active) - Number(a.active) || a.id - b.id);

  return (
    <div className="space-y-4">
      {editing && <HabitFormModal habit={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
      {editingRoutine && <RoutineFormModal routine={editingRoutine === "new" ? undefined : editingRoutine} onClose={() => setEditingRoutine(null)} />}
      <PageHeader
        title="Habitudes"
        subtitle={tab === "habitudes" ? "Tes petites routines : coche-les chaque jour depuis l'accueil."
          : "Des séries de rappels à heures fixes, à activer pour la journée d'un clic."}
        action={tab === "habitudes"
          ? <button type="button" className="btn-primary" onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Nouvelle habitude</button>
          : <button type="button" className="btn-primary" onClick={() => setEditingRoutine("new")}><Plus className="h-4 w-4" /> Nouvelle journalière</button>}
      />
      <Segmented
        full
        value={tab}
        onChange={setTab}
        options={[{ value: "habitudes", label: "Habitudes" }, { value: "journalieres", label: "Journalières" }]}
      />
      {tab === "journalieres" ? <DailyRoutines onEdit={setEditingRoutine} /> : <>
      <Card title="Mes habitudes">
        {habits.isLoading ? <Spinner /> : !list.length ? (
          <Empty>Aucune habitude pour l'instant : « Nouvelle habitude » pour commencer.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.map((h) => (
              <HabitRow key={h.id} habit={h} done={doneBy.get(h.id) ?? new Set()} today={today} oldest={oldest} onEdit={() => setEditing(h)} />
            ))}
          </ul>
        )}
        {list.some((h) => !h.active) && (
          <p className="mt-2 text-xs text-slate-500">En pause : l'habitude et son historique sont gardés, mais elle n'est plus proposée ni rappelée.</p>
        )}
      </Card>
      <Card title={`Historique (${HISTORY_DAYS} derniers jours)`}>
        {logs.isLoading ? <Spinner /> : <History habits={habits.list} logs={logs.data ?? []} today={today} />}
      </Card>
      </>}
    </div>
  );
}
