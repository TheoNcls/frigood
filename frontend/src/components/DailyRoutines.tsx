import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BellRing, Check, Pencil, Plus, Repeat, X } from "lucide-react";
import { api } from "../api/client";
import { useRoutines } from "../api/queries";
import type { DailyRoutine } from "../api/types";
import { useCurrentUser } from "../auth/AuthContext";
import { todayISO } from "../lib/dates";
import { DAY_LABELS, weekday } from "../lib/habits";
import { DaysPicker, ToggleSwitch, usePushActive } from "./HabitInputs";
import Modal from "./Modal";
import { useToast } from "./Toast";
import { ConfirmButton, Empty, Spinner } from "./ui";

const MAX_REMINDERS = 48;
const STEPS = [15, 20, 30, 45, 60, 90, 120];
const WEEKDAYS = [0, 1, 2, 3, 4];
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

const toMin = (h: string) => { const [a, b] = h.split(":").map(Number); return a * 60 + b; };
const toHHMM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** Des rappels réguliers : de « from » à « to » (inclus), toutes les « step » minutes. */
function series(from: string, to: string, step: number, message: string): [string, string][] {
  const out: [string, string][] = [];
  for (let m = toMin(from); m <= toMin(to) && out.length < MAX_REMINDERS; m += step) out.push([toHHMM(m), message]);
  return out;
}

// Pour démarrer vite : tout est modifiable ensuite
const TEMPLATES: { nom: string; jours: number[]; rappels: [string, string][] }[] = [
  { nom: "💻 Télétravail", jours: WEEKDAYS, rappels: [
    ["10:00", "Il faut te lever 🧍"], ["10:30", "Ça fait 30 min !"], ["13:00", "Il faut te lever !"], ["14:00", "Ça fait 1 h, tu peux te rasseoir !"],
  ] },
  { nom: "💧 Boire de l'eau", jours: EVERY_DAY, rappels: series("10:00", "18:00", 120, "Un grand verre d'eau 💧") },
  { nom: "👀 Pause écran", jours: WEEKDAYS, rappels: series("09:00", "17:00", 60, "Regarde au loin 20 secondes 👀") },
];

export function daysText(jours: number[]): string {
  const k = jours.join("");
  if (k === "0123456") return "Tous les jours";
  if (k === "01234") return "Du lundi au vendredi";
  if (k === "56") return "Le week-end";
  return jours.map((d) => DAY_LABELS[d]).join(", ");
}

/** Heure locale « HH:MM », rafraîchie chaque minute (prochain rappel à jour). */
function useNowHHMM(): string {
  const read = () => { const d = new Date(); return toHHMM(d.getHours() * 60 + d.getMinutes()); };
  const [now, setNow] = useState(read);
  useEffect(() => {
    const t = setInterval(() => setNow(read()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function useInvalidateRoutines() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["routines"] });
}

type Row = { key: number; heure: string; message: string };

/** Création ou modification d'une habitude journalière : nom, jours, et ses rappels (heure + message). */
export function RoutineFormModal({ routine, onClose }: { routine?: DailyRoutine; onClose: () => void }) {
  const user = useCurrentUser();
  const toast = useToast();
  const invalidate = useInvalidateRoutines();
  const pushActive = usePushActive();
  const seq = useRef(0);
  const toRows = (list: [string, string][]): Row[] => list.map(([heure, message]) => ({ key: seq.current++, heure, message }));
  const byTime = (list: Row[]) => [...list].sort((a, b) => (a.heure || "99").localeCompare(b.heure || "99"));

  const [nom, setNom] = useState(routine?.nom ?? "");
  const [jours, setJours] = useState<number[]>(routine?.jours ?? WEEKDAYS);
  const [rows, setRows] = useState<Row[]>(() => toRows((routine?.rappels ?? []).map((r) => [r.heure, r.message])));
  const [gen, setGen] = useState<{ open: boolean; from: string; to: string; step: number; message: string }>(
    { open: false, from: "09:00", to: "17:00", step: 60, message: "" });

  const setRow = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = () => {
    if (rows.length >= MAX_REMINDERS) return toast(`${MAX_REMINDERS} rappels au maximum`, "error");
    const last = rows[rows.length - 1];
    const heure = last?.heure ? toHHMM(Math.min(toMin(last.heure) + 30, 23 * 60 + 59)) : "10:00";
    setRows([...rows, { key: seq.current++, heure, message: "" }]);
  };
  const addSeries = () => {
    if (!gen.from || !gen.to || toMin(gen.to) < toMin(gen.from)) return toast("L'heure de fin doit être après celle du début", "error");
    if (!gen.message.trim()) return toast("Écris le message des rappels", "error");
    const seen = new Set(rows.map((r) => `${r.heure}|${r.message.trim()}`));
    const added = toRows(series(gen.from, gen.to, gen.step, gen.message.trim()).filter(([h, m]) => !seen.has(`${h}|${m}`)));
    if (rows.length + added.length > MAX_REMINDERS) return toast(`${MAX_REMINDERS} rappels au maximum`, "error");
    setRows(byTime([...rows, ...added]));
    setGen({ ...gen, open: false, message: "" });
    toast(`${added.length} rappel${added.length > 1 ? "s" : ""} ajouté${added.length > 1 ? "s" : ""}`);
  };
  const applyTemplate = (t: (typeof TEMPLATES)[number]) => {
    setNom(t.nom);
    setJours(t.jours);
    setRows(toRows(t.rappels));
  };

  const filled = rows.every((r) => r.heure && r.message.trim());
  const canSave = !!nom.trim() && rows.length > 0 && filled;
  const save = useMutation({
    mutationFn: () => {
      const body = { nom: nom.trim(), jours, rappels: byTime(rows).map((r) => ({ heure: r.heure, message: r.message.trim() })) };
      return routine
        ? api<DailyRoutine>(`/routines/${routine.id}`, { method: "PUT", body })
        : api<DailyRoutine>(`/users/${user.id}/routines/`, { method: "POST", body });
    },
    onSuccess: (r) => {
      invalidate();
      toast(routine ? `${r.nom} enregistrée` : `${r.nom} ajoutée`);
      onClose();
    },
    onError: (e) => toast(e.message, "error"),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (canSave) save.mutate(); };

  return (
    <Modal title={routine ? "Modifier l'habitude journalière" : "Nouvelle habitude journalière"} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        {!routine && (
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATES.map((t) => (
              <button key={t.nom} type="button" className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-200"
                onClick={() => applyTemplate(t)}>
                {t.nom}
              </button>
            ))}
          </div>
        )}
        <input className="input w-full" value={nom} maxLength={80} onChange={(e) => setNom(e.target.value)}
          placeholder="Télétravail, journée au bureau…" aria-label="Nom de l'habitude journalière" />
        <p className="-mt-2 text-xs text-slate-500">C'est le titre des notifications (un emoji au début, c'est permis).</p>

        <DaysPicker value={jours} onChange={setJours} />

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-800">Rappels ({rows.length})</h3>
            <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"
              onClick={() => setGen({ ...gen, open: !gen.open })} aria-expanded={gen.open}>
              <Repeat className="h-3.5 w-3.5" /> Rappels réguliers
            </button>
          </div>

          {gen.open && (
            <div className="space-y-2 rounded-xl bg-slate-50 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-1.5 text-sm text-slate-700">
                De <input type="time" className="input w-28" value={gen.from} onChange={(e) => setGen({ ...gen, from: e.target.value })} aria-label="Début des rappels réguliers" />
                à <input type="time" className="input w-28" value={gen.to} onChange={(e) => setGen({ ...gen, to: e.target.value })} aria-label="Fin des rappels réguliers" />
                toutes les
                <select className="input w-auto" value={gen.step} onChange={(e) => setGen({ ...gen, step: Number(e.target.value) })} aria-label="Intervalle">
                  {STEPS.map((s) => <option key={s} value={s}>{s < 60 ? `${s} min` : s % 60 ? `${Math.floor(s / 60)} h ${s % 60}` : `${s / 60} h`}</option>)}
                </select>
              </div>
              <input className="input w-full" value={gen.message} maxLength={200} onChange={(e) => setGen({ ...gen, message: e.target.value })}
                placeholder="Message (ex. Lève-toi et marche 2 min)" aria-label="Message des rappels réguliers" />
              <button type="button" className="btn-secondary w-full" onClick={addSeries}>
                <Plus className="h-4 w-4" /> Ajouter {series(gen.from || "00:00", gen.to || "00:00", gen.step, "").length} rappels
              </button>
            </div>
          )}

          {!rows.length ? (
            <p className="rounded-xl border border-dashed border-slate-200 px-3 py-3 text-center text-sm text-slate-500">
              Aucun rappel : ajoute-les un par un, en série, ou pars d'un modèle.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {rows.map((r, i) => (
                <li key={r.key} className="flex items-center gap-1.5">
                  <input type="time" className="input w-[6.5rem] shrink-0" value={r.heure} required
                    onChange={(e) => setRow(r.key, { heure: e.target.value })} onBlur={() => setRows(byTime)}
                    aria-label={`Heure du rappel ${i + 1}`} />
                  <input className="input min-w-0 flex-1" value={r.message} maxLength={200} required placeholder="Message de la notification"
                    onChange={(e) => setRow(r.key, { message: e.target.value })} aria-label={`Message du rappel ${i + 1}`} />
                  <button type="button" className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600"
                    onClick={() => setRows(rows.filter((x) => x.key !== r.key))} aria-label={`Retirer le rappel ${i + 1}`}>
                    <X className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="btn-secondary w-full" onClick={addRow}>
            <Plus className="h-4 w-4" /> Ajouter un rappel
          </button>
          {!filled && <p className="text-xs text-amber-700">Chaque rappel a besoin d'une heure et d'un message.</p>}
        </div>

        <p className="text-xs text-slate-500">
          Les notifications arrivent sur tous tes appareils où elles sont activées, les jours choisis.
          {pushActive === false && <span className="text-amber-700"> Pas activées sur cet appareil : active-les dans le Profil.</span>}
        </p>

        <button type="submit" className="btn-primary w-full" disabled={!canSave || save.isPending}>
          {routine ? <><Check className="h-4 w-4" /> Enregistrer</> : <><Plus className="h-4 w-4" /> Ajouter l'habitude journalière</>}
        </button>
      </form>
    </Modal>
  );
}

function RoutineCard({ routine, now, today, onEdit }: { routine: DailyRoutine; now: string; today: number; onEdit: () => void }) {
  const toast = useToast();
  const invalidate = useInvalidateRoutines();
  const isToday = routine.active && routine.jours.includes(today);
  const next = isToday ? routine.rappels.find((r) => r.heure > now) : undefined;

  const toggle = useMutation({
    mutationFn: (active: boolean) => api<DailyRoutine>(`/routines/${routine.id}`, { method: "PUT", body: { active } }),
    onSuccess: (r) => { invalidate(); toast(r.active ? `${r.nom} : rappels repris` : `${r.nom} en pause`); },
    onError: (e) => toast(e.message, "error"),
  });
  const test = useMutation({
    mutationFn: () => api<{ envoyes: number }>(`/routines/${routine.id}/test`, { method: "POST" }),
    onSuccess: ({ envoyes }) => envoyes
      ? toast(`Notification d'essai envoyée sur ${envoyes} appareil${envoyes > 1 ? "s" : ""}`)
      : toast("Aucun appareil avec les notifications activées : active-les dans le Profil", "error"),
    onError: (e) => toast(e.message, "error"),
  });
  const remove = useMutation({
    mutationFn: () => api(`/routines/${routine.id}`, { method: "DELETE" }),
    onSuccess: () => { invalidate(); toast(`${routine.nom} supprimée`); },
    onError: (e) => toast(e.message, "error"),
  });

  const status = !routine.active ? "En pause : aucun rappel"
    : !routine.jours.includes(today) ? "Pas de rappel aujourd'hui"
      : next ? `Prochain rappel à ${next.heure}` : "Fini pour aujourd'hui ✓";

  return (
    <li className={`card space-y-3 ${routine.active ? "" : "opacity-60"}`}>
      <div className="flex items-start justify-between gap-3">
        <button type="button" className="group min-w-0 text-left" onClick={onEdit} aria-label={`Modifier ${routine.nom}`}>
          <span className="flex items-center gap-1.5">
            <span className="truncate font-semibold text-slate-900">{routine.nom}</span>
            {!routine.active && <span className="badge bg-slate-200 text-slate-600">en pause</span>}
            <Pencil className="h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-slate-500" />
          </span>
          <span className="text-xs text-slate-500">{daysText(routine.jours)} · {routine.rappels.length} rappel{routine.rappels.length > 1 ? "s" : ""}</span>
        </button>
        <ToggleSwitch label={`${routine.nom} active`} checked={routine.active} disabled={toggle.isPending} onChange={(v) => toggle.mutate(v)} />
      </div>

      <ol className="space-y-1" aria-label={`Rappels de ${routine.nom}`}>
        {routine.rappels.map((r) => {
          const isNext = r.id === next?.id;
          const past = isToday && r.heure <= now;
          return (
            <li key={r.id} className={`flex items-baseline gap-2.5 rounded-lg px-2 py-1 text-sm ${
              isNext ? "bg-brand-50 ring-1 ring-brand-200" : ""}`}>
              <span className={`w-11 shrink-0 font-semibold tabular-nums ${past ? "text-slate-400" : "text-slate-800"}`}>{r.heure}</span>
              <span className={`min-w-0 flex-1 ${past ? "text-slate-400" : "text-slate-700"}`}>{r.message}</span>
              {isNext && <span className="badge shrink-0 bg-brand-600 text-white">prochain</span>}
            </li>
          );
        })}
      </ol>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>{status}</span>
        <span className="flex items-center gap-1">
          <button type="button" className="btn-secondary px-2.5 py-1 text-xs" disabled={test.isPending} onClick={() => test.mutate()}>
            <BellRing className="h-3.5 w-3.5" /> Tester
          </button>
          <ConfirmButton compact label="Supprimer l'habitude journalière" confirmLabel="Supprimer" disabled={remove.isPending}
            onConfirm={() => remove.mutate()} />
        </span>
      </div>
    </li>
  );
}

/** Onglet « Journalières » : les habitudes journalières et leurs rappels à heures fixes. */
export default function DailyRoutines({ onEdit }: { onEdit: (routine: DailyRoutine | "new") => void }) {
  const routines = useRoutines();
  const pushActive = usePushActive();
  const now = useNowHHMM();
  const today = weekday(todayISO());
  // Actives d'abord, celles en pause plus bas
  const list = [...routines.list].sort((a, b) => Number(b.active) - Number(a.active) || a.id - b.id);

  return (
    <div className="space-y-3">
      {pushActive === false && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Les notifications ne sont pas activées sur cet appareil : <Link to="/profil" className="font-medium underline">active-les dans le Profil</Link> pour y recevoir ces rappels.
        </p>
      )}
      {routines.isLoading ? <Spinner /> : !list.length ? (
        <div className="card">
          <Empty>
            Des rappels à heures fixes, certains jours. Par exemple en télétravail : 10 h « Il faut te lever », 10 h 30 « Ça fait 30 min ! »…
          </Empty>
          <button type="button" className="btn-primary mx-auto mt-2 flex" onClick={() => onEdit("new")}>
            <Plus className="h-4 w-4" /> Nouvelle habitude journalière
          </button>
        </div>
      ) : (
        <ul className="space-y-3">
          {list.map((r) => <RoutineCard key={r.id} routine={r} now={now} today={today} onEdit={() => onEdit(r)} />)}
        </ul>
      )}
    </div>
  );
}
