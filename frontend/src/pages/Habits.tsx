import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Plus, Undo2 } from "lucide-react";
import { api } from "../api/client";
import { useHabitLogs, useHabits } from "../api/queries";
import type { Habit, HabitLog } from "../api/types";
import { useCurrentUser } from "../auth/AuthContext";
import { useHabitLogActions } from "../components/HabitsToday";
import { useToast } from "../components/Toast";
import { Card, ConfirmButton, Empty, PageHeader, Spinner } from "../components/ui";
import { addDays, parseISODate, todayISO } from "../lib/dates";
import { DAY_LABELS, habitLabel, habitStats, isDue } from "../lib/habits";

const HISTORY_DAYS = 14;
const STATS_DAYS = 60;   // série : jusqu'à 60 jours en arrière

// Pour démarrer vite : nom et emoji pré-remplis (modifiables)
const SUGGESTIONS = [
  { emoji: "🧘", nom: "Méditation" }, { emoji: "📚", nom: "Lecture" }, { emoji: "🎹", nom: "Piano" },
  { emoji: "🤸", nom: "Étirements" }, { emoji: "💧", nom: "Boire 2 L d'eau" }, { emoji: "✍️", nom: "Journal" },
];

/** Les 7 jours en ligne : surligné = l'habitude a lieu ce jour-là. */
function DaysPicker({ value, onChange, disabled = false }: { value: number[]; onChange: (days: number[]) => void; disabled?: boolean }) {
  const toast = useToast();
  return (
    <div className="grid grid-cols-7 gap-1" role="group" aria-label="Jours de l'habitude">
      {DAY_LABELS.map((label, d) => {
        const on = value.includes(d);
        return (
          <button
            key={d}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => {
              if (on && value.length === 1) return toast("Garde au moins un jour", "error");
              onChange(on ? value.filter((x) => x !== d) : [...value, d].sort());
            }}
            className={`rounded-lg py-1.5 text-xs font-semibold transition disabled:opacity-60 ${
              on ? "bg-brand-600 text-white shadow-sm" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

function useInvalidateHabits() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["habits"] });
}

function NewHabit() {
  const user = useCurrentUser();
  const toast = useToast();
  const invalidate = useInvalidateHabits();
  const [nom, setNom] = useState("");
  const [emoji, setEmoji] = useState("");
  const [jours, setJours] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const add = useMutation({
    mutationFn: () => api<Habit>(`/users/${user.id}/habits/`, { method: "POST", body: { nom: nom.trim(), emoji: emoji.trim() || null, jours } }),
    onSuccess: (h) => {
      invalidate();
      toast(`${habitLabel(h)} ajoutée`);
      setNom(""); setEmoji(""); setJours([0, 1, 2, 3, 4, 5, 6]);
    },
    onError: (e) => toast(e.message, "error"),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); if (nom.trim()) add.mutate(); };

  return (
    <Card title="Nouvelle habitude">
      <form onSubmit={submit} className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button key={s.nom} type="button" className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-200"
              onClick={() => { setNom(s.nom); setEmoji(s.emoji); }}>
              {s.emoji} {s.nom}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input className="input w-14 text-center" value={emoji} maxLength={8} onChange={(e) => setEmoji(e.target.value)}
            placeholder="🙂" aria-label="Emoji (facultatif)" />
          <input className="input min-w-0 flex-1" value={nom} maxLength={80} onChange={(e) => setNom(e.target.value)}
            placeholder="Piano, méditation, lecture…" aria-label="Nom de l'habitude" />
        </div>
        <DaysPicker value={jours} onChange={setJours} />
        <button type="submit" className="btn-primary w-full" disabled={!nom.trim() || add.isPending}>
          <Plus className="h-4 w-4" /> Ajouter l'habitude
        </button>
      </form>
    </Card>
  );
}

function HabitRow({ habit, stats }: { habit: Habit; stats: { faites: number; prevues: number; serie: number } }) {
  const toast = useToast();
  const invalidate = useInvalidateHabits();
  const [editing, setEditing] = useState(false);
  const [nom, setNom] = useState(habit.nom);
  const [emoji, setEmoji] = useState(habit.emoji ?? "");
  const update = useMutation({
    mutationFn: (body: Partial<Pick<Habit, "nom" | "emoji" | "jours" | "active">>) =>
      api<Habit>(`/habits/${habit.id}`, { method: "PUT", body }),
    onSuccess: (h, body) => {
      invalidate();
      if (body.active !== undefined) toast(h.active ? `${habitLabel(h)} reprise` : `${habitLabel(h)} en pause`);
      setEditing(false);
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
        {editing ? (
          <form className="flex min-w-0 flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); if (nom.trim()) update.mutate({ nom: nom.trim(), emoji: emoji.trim() || null }); }}>
            <input className="input w-14 text-center" value={emoji} maxLength={8} onChange={(e) => setEmoji(e.target.value)} aria-label="Emoji" />
            <input className="input min-w-0 flex-1" value={nom} maxLength={80} autoFocus onChange={(e) => setNom(e.target.value)} aria-label="Nom" />
            <button type="submit" className="btn-primary px-3" aria-label="Enregistrer" disabled={!nom.trim() || update.isPending}><Check className="h-4 w-4" /></button>
          </form>
        ) : (
          <button type="button" className="group flex min-w-0 items-center gap-1.5 text-left" onClick={() => { setNom(habit.nom); setEmoji(habit.emoji ?? ""); setEditing(true); }}>
            <span className="truncate font-medium text-slate-900">{habitLabel(habit)}</span>
            {!habit.active && <span className="badge bg-slate-200 text-slate-600">en pause</span>}
            <Pencil className="h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-slate-500" />
          </button>
        )}
        <label className="relative mt-0.5 inline-flex shrink-0 cursor-pointer">
          <input
            type="checkbox"
            role="switch"
            aria-label={`${habit.nom} active`}
            className="peer sr-only"
            checked={habit.active}
            disabled={update.isPending}
            onChange={(e) => update.mutate({ active: e.target.checked })}
          />
          <span className="h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-brand-600 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-100" />
          <span className="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
        </label>
      </div>
      <DaysPicker value={habit.jours} onChange={(jours) => update.mutate({ jours })} disabled={update.isPending} />
      <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
        <span>
          {stats.prevues || stats.faites
            ? <>Cette semaine : <b className="text-slate-700">{stats.faites}/{stats.prevues}</b></>
            : "Rien de prévu d'ici dimanche"}
          {stats.serie > 1 && <> · série de <b className="text-slate-700">{stats.serie}</b> 🔥</>}
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

/** Les 14 derniers jours : ce qui a été fait (annulable) et ce qui était prévu (à cocher si oublié). */
function History({ habits, logs, today }: { habits: Habit[]; logs: HabitLog[]; today: string }) {
  const { mark, undo } = useHabitLogActions();
  const byId = new Map(habits.map((h) => [h.id, h]));
  const days = Array.from({ length: HISTORY_DAYS }, (_, i) => addDays(today, -i));
  const rows = days.map((d) => {
    const done = logs.filter((l) => l.date === d && byId.has(l.habit_id));
    const doneIds = new Set(done.map((l) => l.habit_id));
    const missed = habits.filter((h) => isDue(h, d) && !doneIds.has(h.id));
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

  const doneBy = useMemo(() => {
    const m = new Map<number, Set<string>>();
    for (const l of logs.data ?? []) {
      if (!m.has(l.habit_id)) m.set(l.habit_id, new Set());
      m.get(l.habit_id)!.add(l.date);
    }
    return m;
  }, [logs.data]);
  // Actives d'abord, celles en pause plus bas
  const list = [...habits.list].sort((a, b) => Number(b.active) - Number(a.active) || a.id - b.id);

  return (
    <div className="space-y-4">
      <PageHeader title="Habitudes" subtitle="Tes petites routines : choisis leurs jours, et coche-les chaque jour depuis l'accueil." />
      <NewHabit />
      <Card title="Mes habitudes">
        {habits.isLoading ? <Spinner /> : !list.length ? (
          <Empty>Aucune habitude pour l'instant : ajoute la première ci-dessus.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.map((h) => (
              <HabitRow key={h.id} habit={h} stats={habitStats(h, doneBy.get(h.id) ?? new Set(), today, oldest)} />
            ))}
          </ul>
        )}
        {list.some((h) => !h.active) && (
          <p className="mt-2 text-xs text-slate-500">En pause : l'habitude et son historique sont gardés, mais elle n'est plus proposée chaque jour.</p>
        )}
      </Card>
      <Card title={`Historique (${HISTORY_DAYS} derniers jours)`}>
        {logs.isLoading ? <Spinner /> : <History habits={habits.list} logs={logs.data ?? []} today={today} />}
      </Card>
    </div>
  );
}
