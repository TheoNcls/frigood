import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Activity as ActivityIcon, AlarmClock, ArrowRight, Check, ListTodo, Plus, Repeat, Sparkles, Star, X } from "lucide-react";
import { api } from "../api/client";
import type { Recurrence, TaskInput, TaskOccurrence, TaskStatut } from "../api/types";
import { useActivityTypes, useTasks } from "../api/queries";
import { useCurrentUser } from "../auth/AuthContext";
import { addDays, daysBetween, formatFull, formatLong, formatShort, parseISODate, todayISO } from "../lib/dates";
import AddEntryModal from "./AddEntry";
import { ExercisesList, GarminSendButton, SeanceSteps } from "./Seance";
import Modal from "./Modal";
import { useToast } from "./Toast";
import { ConfirmButton, Field, Segmented } from "./ui";

export const TASK_COLOR = "#7c3aed";
/** Tâches importantes : ambre, la couleur de l'étoile */
export const IMPORTANT_COLOR = "#d97706";

export const RECURRENCE_LABELS: Record<Recurrence, string> = {
  daily: "Tous les jours",
  weekly: "Toutes les semaines",
  monthly: "Tous les mois",
};

const STATUT_LABELS: Record<TaskStatut | "a_faire", string> = {
  a_faire: "À faire",
  fait: "Faite",
  pas_fait: "Pas faite",
};

export function useInvalidateTasks() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["tasks"] });
}

/** Change le statut d'une ou plusieurs occurrences (null = à faire). */
export function useSetStatut() {
  const invalidate = useInvalidateTasks();
  const toast = useToast();
  return useMutation({
    mutationFn: async ({ tasks, statut }: { tasks: TaskOccurrence[]; statut: TaskStatut | null }) => {
      for (const o of tasks) {
        await api(`/tasks/${o.task_id}/done`, { method: "POST", body: { date: o.date, statut } });
      }
    },
    onSuccess: invalidate,
    onError: (e) => toast(e.message, "error"),
  });
}

/** Case à cocher : faite ↔ à faire (une tâche « pas faite » cochée devient faite). */
export function useToggleTask() {
  const set = useSetStatut();
  return {
    isPending: set.isPending,
    mutate: (o: TaskOccurrence, opts?: { onSuccess?: () => void }) =>
      set.mutate({ tasks: [o], statut: o.statut === "fait" ? null : "fait" }, opts),
  };
}

/** Une tâche avec sa case à cocher ; un clic sur le titre ouvre la modification. */
export function TaskRow({ task, onEdit }: { task: TaskOccurrence; onEdit: (t: TaskOccurrence) => void }) {
  const toggle = useToggleTask();
  const missed = task.statut === "pas_fait";
  return (
    <li className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm ${
      missed ? "bg-rose-50/70" : task.important ? "border-l-4 border-amber-400 bg-amber-50 pl-2" : "bg-violet-50/60"
    }`}>
      <button
        type="button"
        role="checkbox"
        aria-checked={task.fait}
        aria-label={task.auto ? `« ${task.titre} » validée par l'activité du jour` : task.fait ? `Marquer « ${task.titre} » comme à faire` : `Marquer « ${task.titre} » comme faite`}
        title={task.auto ? "Validée automatiquement par l'activité du jour" : undefined}
        disabled={toggle.isPending || task.auto}
        onClick={() => toggle.mutate(task)}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition ${
          task.fait
            ? "border-violet-600 bg-violet-600 text-white"
            : missed
              ? "border-rose-300 bg-white text-rose-500 hover:border-violet-500"
              : task.important
                ? "border-amber-400 bg-white hover:border-amber-600"
                : "border-violet-300 bg-white hover:border-violet-500"
        }`}
      >
        {task.fait && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
        {missed && <X className="h-3.5 w-3.5" strokeWidth={3} />}
      </button>
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onEdit(task)}>
        <span className={`block truncate font-medium ${task.fait ? "text-slate-400 line-through" : missed ? "text-rose-400 line-through" : "text-slate-900"}`}>
          {task.important && <Star className="mr-1 inline h-3.5 w-3.5 -translate-y-px fill-amber-400 text-amber-500" aria-label="Importante" />}
          {task.heure && <span className={`mr-1.5 ${task.important ? "text-amber-700" : "text-violet-700"}`}>{task.heure}</span>}
          {task.titre}
          {task.par_coach && (
            <span className="ml-1.5 inline-flex -translate-y-px items-center gap-0.5 rounded-full bg-violet-100 px-1.5 py-px align-middle text-[10px] font-semibold text-violet-700 no-underline">
              <Sparkles className="h-2.5 w-2.5" /> Coach
            </span>
          )}
        </span>
        {(task.recurrence || task.notes || missed || task.activity_type_nom) && (
          <span className="block truncate text-xs text-slate-500">
            {task.activity_type_nom && (
              <span className={task.auto ? "font-medium text-emerald-700" : "text-orange-700"}>
                <ActivityIcon className="mr-1 inline h-3 w-3" />
                {task.auto ? `Validée par l'activité ${task.activity_type_nom}` : task.activity_type_nom}
              </span>
            )}
            {task.activity_type_nom && (missed || task.recurrence || task.notes) ? " · " : ""}
            {missed && <span className="text-rose-500">Pas faite</span>}
            {missed && (task.recurrence || task.notes) ? " · " : ""}
            {task.recurrence && <><Repeat className="mr-1 inline h-3 w-3" />{RECURRENCE_LABELS[task.recurrence]}</>}
            {task.recurrence && task.notes ? " · " : ""}
            {task.notes}
          </span>
        )}
      </button>
    </li>
  );
}

/** Création (date donnée) ou modification (occurrence donnée) d'une tâche, dans sa fenêtre. */
export function TaskForm({ date, task, onClose }: { date?: string; task?: TaskOccurrence; onClose: () => void }) {
  return (
    <Modal title={task ? "Tâche" : "Nouvelle tâche"} onClose={onClose}>
      <TaskFormBody date={date} task={task} onClose={onClose} />
    </Modal>
  );
}

/** Formulaire de tâche seul : aussi utilisé dans l'onglet « Tâche » de la fenêtre d'ajout. */
export function TaskFormBody({ date, task, onClose }: { date?: string; task?: TaskOccurrence; onClose: () => void }) {
  const user = useCurrentUser();
  const invalidate = useInvalidateTasks();
  const toast = useToast();
  const setStatut = useSetStatut();
  const editing = !!task;
  const [f, setF] = useState({
    titre: task?.titre ?? "",
    // Une série se modifie depuis sa première date, pas depuis l'occurrence cliquée
    date: task?.serie_debut ?? date ?? "",
    heure: task?.heure ?? "",
    recurrence: (task?.recurrence ?? "") as Recurrence | "",
    recurrence_fin: task?.recurrence_fin ?? "",
    notes: task?.notes ?? "",
    important: task?.important ?? false,
    activity_type_id: task?.activity_type_id ? String(task.activity_type_id) : "",
  });
  const types = useActivityTypes();
  const set = (key: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [key]: e.target.value });

  const body = (): TaskInput => ({
    titre: f.titre.trim(),
    date: f.date,
    heure: f.heure || null,
    recurrence: f.recurrence || null,
    recurrence_fin: f.recurrence && f.recurrence_fin ? f.recurrence_fin : null,
    notes: f.notes.trim() || null,
    important: f.important,
    activity_type_id: f.activity_type_id ? Number(f.activity_type_id) : null,
  });

  const save = useMutation({
    mutationFn: () => editing
      ? api(`/tasks/${task.task_id}`, { method: "PUT", body: body() })
      : api(`/users/${user.id}/tasks/`, { method: "POST", body: body() }),
    onSuccess: () => { invalidate(); toast(editing ? "Tâche modifiée" : "Tâche ajoutée"); onClose(); },
    onError: (e) => toast(e.message, "error"),
  });

  const remove = useMutation({
    mutationFn: () => api(`/tasks/${task!.task_id}`, { method: "DELETE" }),
    onSuccess: () => { invalidate(); toast("Tâche supprimée"); onClose(); },
    onError: (e) => toast(e.message, "error"),
  });


  return (
    <>
      {editing && (
        <div className="mb-4 space-y-2 rounded-xl bg-violet-50 px-3 py-2.5 text-sm">
          <div className="text-violet-900">
            {formatLong(task.date)}
            {task.auto && task.activity_type_nom ? (
              <span className="block text-xs font-medium text-emerald-700">
                Validée automatiquement : activité {task.activity_type_nom} ce jour-là
              </span>
            ) : null}
            {task.statut && task.done_at ? (
              <span className="block text-xs text-violet-700">
                {task.statut === "fait" ? "Faite" : "Marquée pas faite"} le {formatFull(task.done_at)}
              </span>
            ) : null}
          </div>
          {((task.seance && task.seance.length > 0) || (task.exercices && task.exercices.length > 0)) && (
            <div className="space-y-2 rounded-lg bg-white/80 p-2">
              <div className="text-xs font-semibold text-slate-600">Séance</div>
              {task.seance && task.seance.length > 0 && <SeanceSteps steps={task.seance} />}
              {task.exercices && task.exercices.length > 0 && <ExercisesList exercises={task.exercices} />}
              {/* Une séance faite est retirée de la montre à la synchro suivante : plus rien à envoyer */}
              {!task.recurrence && task.date >= todayISO() && !task.fait && <GarminSendButton task={task} />}
            </div>
          )}
          <Segmented
            full
            value={task.statut ?? "a_faire"}
            onChange={(v) => setStatut.mutate(
              { tasks: [task], statut: v === "a_faire" ? null : v },
              { onSuccess: onClose },
            )}
            options={(["a_faire", "fait", "pas_fait"] as const).map((v) => ({ value: v, label: STATUT_LABELS[v] }))}
          />
        </div>
      )}
      <form
        className="space-y-3"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!f.titre.trim() || !f.date) return toast("Titre et date obligatoires", "error");
          save.mutate();
        }}
      >
        <Field label="Titre">
          <input className="input" required autoFocus={!editing} value={f.titre} onChange={set("titre")} placeholder="ex. Faire les courses, Préparer le dahl…" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={f.recurrence ? "À partir du" : "Date"}>
            <input className="input" type="date" required value={f.date} onChange={set("date")} />
          </Field>
          <Field label="Heure (facultative)">
            <input className="input" type="time" value={f.heure} onChange={set("heure")} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Répéter">
            <select className="input" value={f.recurrence} onChange={set("recurrence")}>
              <option value="">Jamais</option>
              {(Object.keys(RECURRENCE_LABELS) as Recurrence[]).map((r) => <option key={r} value={r}>{RECURRENCE_LABELS[r]}</option>)}
            </select>
          </Field>
          {f.recurrence && (
            <Field label="Jusqu'au (facultatif)">
              <input className="input" type="date" min={f.date} value={f.recurrence_fin} onChange={set("recurrence_fin")} />
            </Field>
          )}
        </div>
        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2">
          <input
            type="checkbox"
            className="h-4 w-4 accent-amber-500"
            checked={f.important}
            onChange={(e) => setF({ ...f, important: e.target.checked })}
          />
          <span className="flex items-center gap-1 text-sm font-medium text-slate-800">
            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" /> Importante
          </span>
        </label>
        <Field
          label="Sport associé (facultatif)"
          hint={f.activity_type_id
            ? "Validée toute seule dès qu'une activité de ce type est enregistrée ce jour-là (Garmin ou à la main)."
            : "Pour une séance prévue (ex. Course tempo 20 min) : choisis le sport, la tâche se validera avec l'activité."}
        >
          <select className="input" value={f.activity_type_id} onChange={set("activity_type_id")}>
            <option value="">Aucun</option>
            {types.list.map((t) => <option key={t.id} value={t.id}>{t.nom}</option>)}
          </select>
        </Field>
        <Field label="Notes (facultatif)">
          <AutoTextarea value={f.notes} onChange={(v) => setF({ ...f, notes: v })} />
        </Field>
        {editing && task.recurrence && (
          <p className="text-xs text-slate-500">Les modifications s'appliquent à toute la série.</p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          {editing ? (
            <ConfirmButton
              label={task.recurrence ? "Supprimer la série" : "Supprimer"}
              disabled={remove.isPending}
              onConfirm={() => remove.mutate()}
            />
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={onClose}>Annuler</button>
            <button type="submit" className="btn-primary" disabled={save.isPending}>{editing ? "Enregistrer" : "Ajouter"}</button>
          </div>
        </div>
      </form>
    </>
  );
}

/**
 * Combien de jours une tâche non tranchée reste « en retard » sur l'accueil.
 * Importante : une ponctuelle reste jusqu'à ce qu'on la traite (un an max), une récurrente un mois.
 */
const OVERDUE_LOOKBACK = 365;
function overdueDays(t: TaskOccurrence): number {
  if (t.important) return t.recurrence ? 30 : OVERDUE_LOOKBACK;
  return t.recurrence ? 7 : 30;
}

function taskInput(t: TaskOccurrence, changes: Partial<TaskInput> = {}): TaskInput {
  return {
    titre: t.titre, notes: t.notes, date: t.serie_debut, heure: t.heure,
    recurrence: t.recurrence, recurrence_fin: t.recurrence_fin, important: t.important,
    activity_type_id: t.activity_type_id, ...changes,
  };
}

function ago(iso: string): string {
  const n = daysBetween(iso, todayISO());
  const day = parseDay(iso);
  return n === 1 ? `Hier (${day})` : `Il y a ${n} j (${day})`;
}

function inDays(iso: string): string {
  const n = daysBetween(todayISO(), iso);
  if (n === 0) return "Aujourd'hui";
  if (n === 1) return `Demain (${parseDay(iso)})`;
  return `Dans ${n} j (${parseDay(iso)})`;
}

function parseDay(iso: string): string {
  return `${parseISODate(iso).toLocaleDateString("fr-FR", { weekday: "short" })} ${formatShort(iso)}`;
}

const byImportanceThenDate = (a: TaskOccurrence, b: TaskOccurrence) =>
  Number(b.important) - Number(a.important) || b.date.localeCompare(a.date) || (a.heure ?? "").localeCompare(b.heure ?? "");

const linkBtn = "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-violet-100 disabled:opacity-50";

/**
 * Tâches passées ni faites ni « pas faites » : oubli de cocher (on coche, la tâche est faite à sa date),
 * vrai retard (on la reporte à aujourd'hui) ou abandon (pas faite).
 */
export function OverdueTasks() {
  const today = todayISO();
  const tasks = useTasks(addDays(today, -OVERDUE_LOOKBACK), addDays(today, -1));
  const invalidate = useInvalidateTasks();
  const toast = useToast();
  const setStatut = useSetStatut();
  const [editing, setEditing] = useState<TaskOccurrence | null>(null);

  const postpone = useMutation({
    mutationFn: (t: TaskOccurrence) => api(`/tasks/${t.task_id}`, { method: "PUT", body: taskInput(t, { date: today }) }),
    onSuccess: () => { invalidate(); toast("Tâche reportée à aujourd'hui"); },
    onError: (e) => toast(e.message, "error"),
  });

  const late = (tasks.data ?? [])
    .filter((t) => !t.statut && t.date >= addDays(today, -overdueDays(t)))
    .sort(byImportanceThenDate);

  if (!late.length) return null;

  // Une ligne par tâche récurrente (occurrence la plus récente), les autres jours manqués en pastilles
  const groups: { main: TaskOccurrence; others: TaskOccurrence[] }[] = [];
  const byTask = new Map<number, { main: TaskOccurrence; others: TaskOccurrence[] }>();
  for (const t of late) {
    const g = t.recurrence ? byTask.get(t.task_id) : undefined;
    if (g) g.others.push(t);
    else {
      const ng = { main: t, others: [] };
      groups.push(ng);
      if (t.recurrence) byTask.set(t.task_id, ng);
    }
  }

  return (
    <section className="card border-violet-200 bg-violet-50/40">
      {editing && <TaskForm task={editing} onClose={() => setEditing(null)} />}
      <div className="mb-1 flex items-center gap-2">
        <AlarmClock className="h-5 w-5 text-violet-700" />
        <h2 className="card-title mb-0">En retard ({late.length})</h2>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Coche ce qui a été fait (oubli de cocher), reporte ce qui reste à faire, ou marque-la pas faite.
      </p>
      <div className="space-y-2">
        {groups.map(({ main: t, others }) => {
          const all = [t, ...others];
          return (
            <div key={`${t.task_id}-${t.date}`} className="space-y-0.5">
              <div className="flex flex-wrap items-center justify-between gap-x-2 px-1 text-[11px] font-medium text-violet-700">
                <span>{ago(t.date)}</span>
                <span className="flex flex-wrap items-center gap-0.5">
                  <button
                    type="button"
                    className={`${linkBtn} text-rose-600 hover:bg-rose-50`}
                    disabled={setStatut.isPending}
                    onClick={() => setStatut.mutate({ tasks: all, statut: "pas_fait" })}
                  >
                    <X className="h-3 w-3" /> {all.length > 1 ? `Pas faite (${all.length} j)` : "Pas faite"}
                  </button>
                  {!t.recurrence && (
                    <button type="button" className={linkBtn} disabled={postpone.isPending} onClick={() => postpone.mutate(t)}>
                      Reporter à aujourd'hui <ArrowRight className="h-3 w-3" />
                    </button>
                  )}
                </span>
              </div>
              <ul><TaskRow task={t} onEdit={setEditing} /></ul>
              {others.length > 0 && (
                <div className="flex flex-wrap items-center gap-1 px-1 pt-0.5 text-[11px] text-slate-500">
                  <span>Aussi non cochée :</span>
                  {others.map((o) => <MissedChip key={o.date} task={o} />)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Autre jour manqué d'une tâche récurrente : un clic le marque comme fait. */
function MissedChip({ task }: { task: TaskOccurrence }) {
  const toggle = useToggleTask();
  return (
    <button
      type="button"
      title="Marquer comme faite ce jour-là"
      aria-label={`Marquer « ${task.titre} » du ${parseDay(task.date)} comme faite`}
      disabled={toggle.isPending}
      onClick={() => toggle.mutate(task)}
      className="inline-flex items-center gap-1 rounded-full border border-violet-200 bg-white px-2 py-0.5 text-violet-800 hover:border-violet-400 hover:bg-violet-50"
    >
      <Check className="h-3 w-3" /> {parseDay(task.date)}
    </button>
  );
}

/** Tâches importantes des 3 prochains jours (aujourd'hui est dans la carte du jour), encore à faire. */
export function UpcomingImportant() {
  const today = todayISO();
  const tasks = useTasks(addDays(today, 1), addDays(today, 3));
  const [editing, setEditing] = useState<TaskOccurrence | null>(null);
  const upcoming = (tasks.data ?? []).filter((t) => t.important && !t.statut);
  if (!upcoming.length) return null;

  return (
    <section className="card border-amber-200 bg-amber-50/40">
      {editing && <TaskForm task={editing} onClose={() => setEditing(null)} />}
      <div className="mb-3 flex items-center gap-2">
        <Star className="h-5 w-5 fill-amber-400 text-amber-500" />
        <h2 className="card-title mb-0">Important à venir</h2>
      </div>
      <div className="space-y-2">
        {upcoming.map((t) => (
          <div key={`${t.task_id}-${t.date}`} className="space-y-0.5">
            <div className="px-1 text-[11px] font-medium text-amber-700">{inDays(t.date)}</div>
            <ul><TaskRow task={t} onEdit={setEditing} /></ul>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Tâches du jour : importantes d'abord, puis par heure ; les tâches tranchées restent visibles (barrées). */
export function TodayTasks() {
  const today = todayISO();
  const tasks = useTasks(today, today);
  const [editing, setEditing] = useState<TaskOccurrence | null>(null);
  const [adding, setAdding] = useState(false);
  const list = [...(tasks.data ?? [])].sort(
    (a, b) => Number(!!a.statut) - Number(!!b.statut) || Number(b.important) - Number(a.important) || (a.heure ?? "99").localeCompare(b.heure ?? "99"),
  );
  if (!list.length) return null;
  const done = list.filter((t) => t.statut === "fait").length;

  return (
    <section className="card border-violet-200">
      {editing && <TaskForm task={editing} onClose={() => setEditing(null)} />}
      {adding && <AddEntryModal date={today} initialTab="tache" onClose={() => setAdding(false)} />}
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ListTodo className="h-5 w-5 text-violet-700" />
          <h2 className="card-title mb-0">Aujourd'hui</h2>
          <span className="text-xs font-medium text-slate-500">{done}/{list.length} faite{done > 1 ? "s" : ""}</span>
        </div>
        <button type="button" className="btn-ghost py-1 text-violet-700" onClick={() => setAdding(true)}>
          <Plus className="h-4 w-4" /> Ajouter
        </button>
      </div>
      <ul className="space-y-1.5">
        {list.map((t) => <TaskRow key={`${t.task_id}-${t.date}`} task={t} onEdit={setEditing} />)}
      </ul>
    </section>
  );
}

/** Zone de texte qui s'agrandit avec son contenu (jusqu'à la moitié de l'écran, puis défile). */
function AutoTextarea({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight + 2, window.innerHeight * 0.5)}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={2}
      className="input resize-none overflow-y-auto"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
