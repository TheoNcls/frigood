import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlarmClock, ArrowRight, Check, Repeat } from "lucide-react";
import { api } from "../api/client";
import type { Recurrence, TaskInput, TaskOccurrence } from "../api/types";
import { useTasks } from "../api/queries";
import { useCurrentUser } from "../auth/AuthContext";
import { addDays, daysBetween, formatFull, formatLong, formatShort, parseISODate, todayISO } from "../lib/dates";
import Modal from "./Modal";
import { useToast } from "./Toast";
import { ConfirmButton, Field } from "./ui";

export const TASK_COLOR = "#7c3aed";

export const RECURRENCE_LABELS: Record<Recurrence, string> = {
  daily: "Tous les jours",
  weekly: "Toutes les semaines",
  monthly: "Tous les mois",
};

export function useInvalidateTasks() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["tasks"] });
}

export function useToggleTask() {
  const invalidate = useInvalidateTasks();
  const toast = useToast();
  return useMutation({
    mutationFn: (o: TaskOccurrence) => api(`/tasks/${o.task_id}/done`, { method: "POST", body: { date: o.date, fait: !o.fait } }),
    onSuccess: invalidate,
    onError: (e) => toast(e.message, "error"),
  });
}

/** Une tâche avec sa case à cocher ; un clic sur le titre ouvre la modification. */
export function TaskRow({ task, onEdit }: { task: TaskOccurrence; onEdit: (t: TaskOccurrence) => void }) {
  const toggle = useToggleTask();
  return (
    <li className="flex items-center gap-3 rounded-xl bg-violet-50/60 px-3 py-2 text-sm">
      <button
        type="button"
        role="checkbox"
        aria-checked={task.fait}
        aria-label={task.fait ? `Marquer « ${task.titre} » comme à faire` : `Marquer « ${task.titre} » comme faite`}
        disabled={toggle.isPending}
        onClick={() => toggle.mutate(task)}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition ${
          task.fait ? "border-violet-600 bg-violet-600 text-white" : "border-violet-300 bg-white hover:border-violet-500"
        }`}
      >
        {task.fait && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
      </button>
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onEdit(task)}>
        <span className={`block truncate font-medium ${task.fait ? "text-slate-400 line-through" : "text-slate-900"}`}>
          {task.heure && <span className="mr-1.5 text-violet-700">{task.heure}</span>}
          {task.titre}
        </span>
        {(task.recurrence || task.notes) && (
          <span className="block truncate text-xs text-slate-500">
            {task.recurrence && <><Repeat className="mr-1 inline h-3 w-3" />{RECURRENCE_LABELS[task.recurrence]}</>}
            {task.recurrence && task.notes ? " · " : ""}
            {task.notes}
          </span>
        )}
      </button>
    </li>
  );
}

/** Création (date donnée) ou modification (occurrence donnée) d'une tâche. */
export function TaskForm({ date, task, onClose }: { date?: string; task?: TaskOccurrence; onClose: () => void }) {
  const user = useCurrentUser();
  const invalidate = useInvalidateTasks();
  const toast = useToast();
  const toggle = useToggleTask();
  const editing = !!task;
  const [f, setF] = useState({
    titre: task?.titre ?? "",
    // Une série se modifie depuis sa première date, pas depuis l'occurrence cliquée
    date: task?.serie_debut ?? date ?? "",
    heure: task?.heure ?? "",
    recurrence: (task?.recurrence ?? "") as Recurrence | "",
    recurrence_fin: task?.recurrence_fin ?? "",
    notes: task?.notes ?? "",
  });
  const set = (key: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [key]: e.target.value });

  const body = (): TaskInput => ({
    titre: f.titre.trim(),
    date: f.date,
    heure: f.heure || null,
    recurrence: f.recurrence || null,
    recurrence_fin: f.recurrence && f.recurrence_fin ? f.recurrence_fin : null,
    notes: f.notes.trim() || null,
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
    <Modal title={editing ? "Tâche" : "Nouvelle tâche"} onClose={onClose}>
      {editing && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl bg-violet-50 px-3 py-2 text-sm">
          <span className="text-violet-900">
            {formatLong(task.date)}
            {task.fait && task.done_at ? <span className="block text-xs text-violet-700">Faite le {formatFull(task.done_at)}</span> : null}
          </span>
          <button
            type="button"
            className={task.fait ? "btn-secondary" : "btn-primary bg-violet-600 hover:bg-violet-700"}
            disabled={toggle.isPending}
            onClick={() => toggle.mutate(task, { onSuccess: onClose })}
          >
            <Check className="h-4 w-4" /> {task.fait ? "Marquer à faire" : "Marquer comme faite"}
          </button>
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
        <Field label="Notes (facultatif)">
          <textarea className="input min-h-[3.5rem]" value={f.notes} onChange={set("notes")} />
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
    </Modal>
  );
}

/** Jours regardés en arrière : une tâche ponctuelle reste « en retard » longtemps, une occurrence récurrente une semaine. */
const OVERDUE_DAYS = 30;
const OVERDUE_RECURRING_DAYS = 7;

function taskInput(t: TaskOccurrence, changes: Partial<TaskInput> = {}): TaskInput {
  return {
    titre: t.titre, notes: t.notes, date: t.serie_debut, heure: t.heure,
    recurrence: t.recurrence, recurrence_fin: t.recurrence_fin, ...changes,
  };
}

function ago(iso: string): string {
  const n = daysBetween(iso, todayISO());
  const day = parseDay(iso);
  return n === 1 ? `Hier (${day})` : `Il y a ${n} j (${day})`;
}

function parseDay(iso: string): string {
  return `${parseISODate(iso).toLocaleDateString("fr-FR", { weekday: "short" })} ${formatShort(iso)}`;
}

/**
 * Tâches passées non cochées : oubli de cocher (on coche, la tâche est faite à sa date)
 * ou vrai retard (on la reporte à aujourd'hui pour une tâche ponctuelle).
 */
export function OverdueTasks() {
  const today = todayISO();
  const tasks = useTasks(addDays(today, -OVERDUE_DAYS), addDays(today, -1));
  const invalidate = useInvalidateTasks();
  const toast = useToast();
  const [editing, setEditing] = useState<TaskOccurrence | null>(null);

  const postpone = useMutation({
    mutationFn: (t: TaskOccurrence) => api(`/tasks/${t.task_id}`, { method: "PUT", body: taskInput(t, { date: today }) }),
    onSuccess: () => { invalidate(); toast("Tâche reportée à aujourd'hui"); },
    onError: (e) => toast(e.message, "error"),
  });

  const recurringFrom = addDays(today, -OVERDUE_RECURRING_DAYS);
  const late = (tasks.data ?? [])
    .filter((t) => !t.fait && (!t.recurrence || t.date >= recurringFrom))
    .sort((a, b) => b.date.localeCompare(a.date) || (a.heure ?? "").localeCompare(b.heure ?? ""));

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
        Coche ce qui a été fait (oubli de cocher) ; reporte ce qui reste à faire.
      </p>
      <div className="space-y-2">
        {groups.map(({ main: t, others }) => (
          <div key={`${t.task_id}-${t.date}`} className="space-y-0.5">
            <div className="flex items-center justify-between gap-2 px-1 text-[11px] font-medium text-violet-700">
              <span>{ago(t.date)}</span>
              {!t.recurrence && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-violet-100"
                  disabled={postpone.isPending}
                  onClick={() => postpone.mutate(t)}
                >
                  Reporter à aujourd'hui <ArrowRight className="h-3 w-3" />
                </button>
              )}
            </div>
            <ul><TaskRow task={t} onEdit={setEditing} /></ul>
            {others.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 px-1 pt-0.5 text-[11px] text-slate-500">
                <span>Aussi non cochée :</span>
                {others.map((o) => <MissedChip key={o.date} task={o} />)}
              </div>
            )}
          </div>
        ))}
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
