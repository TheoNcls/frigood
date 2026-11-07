import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Sprout } from "lucide-react";
import { api } from "../api/client";
import { useHabitLogs, useHabits } from "../api/queries";
import type { Habit, HabitLog } from "../api/types";
import { useCurrentUser } from "../auth/AuthContext";
import { todayISO } from "../lib/dates";
import { doneDates, habitLabel, isDue, isGoal, weekCount, weekStart } from "../lib/habits";
import { useToast } from "./Toast";

/** Cocher une habitude (aujourd'hui ou un jour oublié) et annuler : partagé par l'accueil et l'onglet Habitudes. */
export function useHabitLogActions() {
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const toast = useToast();
  const key = ["habit_logs", user.id];
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  const mark = useMutation({
    mutationFn: ({ habit, date }: { habit: Habit; date: string }) =>
      api<HabitLog>(`/users/${user.id}/habit_logs/`, { method: "POST", body: { habit_id: habit.id, date } }),
    // Le bouton disparaît tout de suite, sans attendre le serveur
    onMutate: ({ habit, date }) => {
      queryClient.setQueriesData<HabitLog[]>({ queryKey: key }, (old) =>
        old && !old.some((l) => l.habit_id === habit.id && l.date === date)
          ? [{ id: -Date.now(), habit_id: habit.id, date, done_at: null }, ...old]
          : old);
    },
    onSuccess: (_log, { habit }) => toast(`${habitLabel(habit)} : fait ✓`),
    onError: (e) => toast(e.message, "error"),
    onSettled: refresh,
  });

  const undo = useMutation({
    mutationFn: (log: HabitLog) => api(`/habit_logs/${log.id}`, { method: "DELETE" }),
    onMutate: (log) => {
      queryClient.setQueriesData<HabitLog[]>({ queryKey: key }, (old) => old?.filter((l) => l.id !== log.id));
    },
    onSuccess: () => toast("Annulé"),
    onError: (e) => toast(e.message, "error"),
    onSettled: refresh,
  });

  return { mark, undo };
}

/** Accueil : les habitudes du jour, une case cliquable chacune, qui disparaît une fois cochée. */
export default function HabitsToday() {
  const today = todayISO();
  const habits = useHabits();
  // Depuis lundi : pour les objectifs « X fois par semaine »
  const logs = useHabitLogs(weekStart(today), today);
  const { mark } = useHabitLogActions();

  const rows = habits.list.map((h) => {
    const done = doneDates(logs.data, h.id);
    return { h, done, doneToday: done.has(today), due: isDue(h, today, done) };
  });
  const todo = rows.filter((r) => r.due && !r.doneToday);
  const doneList = rows.filter((r) => r.doneToday).map((r) => r.h);
  const counted = rows.filter((r) => r.due);
  if (!counted.length && !doneList.length) return null;

  return (
    <section className="card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sprout className="h-5 w-5 text-emerald-600" />
          <h2 className="card-title mb-0">Habitudes</h2>
          {counted.length > 0 && (
            <span className="text-xs font-medium text-slate-500">{counted.filter((r) => r.doneToday).length}/{counted.length}</span>
          )}
        </div>
        <Link to="/habitudes" className="text-sm font-medium text-brand-700">Tout voir →</Link>
      </div>
      {todo.length > 0 ? (
        <div className="flex flex-col gap-2">
          {todo.map(({ h, done }) => (
            <button
              key={h.id}
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-white px-3 py-2.5 text-left text-sm font-medium text-slate-800 transition hover:bg-emerald-50 active:scale-[0.98]"
              onClick={() => mark.mutate({ habit: h, date: today })}
            >
              <span className="min-w-0 truncate">{habitLabel(h)}</span>
              {isGoal(h) && (
                <span className="shrink-0 text-xs font-normal text-slate-400">{weekCount(done, today)}/{h.objectif_semaine} sem.</span>
              )}
            </button>
          ))}
        </div>
      ) : (
        <p className="rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">✓ Tout est fait pour aujourd'hui</p>
      )}
      {doneList.length > 0 && todo.length > 0 && (
        <p className="mt-2 text-xs text-slate-500">Fait : {doneList.map(habitLabel).join(" · ")}</p>
      )}
    </section>
  );
}
