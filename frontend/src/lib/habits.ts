import type { Habit, HabitLog } from "../api/types";
import { addDays, parseISODate, toISODate } from "./dates";

/** 0 = lundi … 6 = dimanche (comme le serveur) */
export const DAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

export function weekday(iso: string): number {
  return (parseISODate(iso).getDay() + 6) % 7;
}

/** Lundi de la semaine de ce jour */
export function weekStart(iso: string): string {
  return addDays(iso, -weekday(iso));
}

export function habitLabel(habit: Habit): string {
  return habit.emoji ? `${habit.emoji} ${habit.nom}` : habit.nom;
}

/** Objectif « X fois par semaine » (n'importe quels jours) plutôt que des jours précis */
export function isGoal(habit: Habit): boolean {
  return !!habit.objectif_semaine;
}

/** Jour (heure locale) où l'habitude a été créée : avant, rien n'était prévu. */
export function createdDay(habit: Habit): string | null {
  if (!habit.created_at) return null;
  const s = habit.created_at;
  return toISODate(new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`));
}

/** Jours où elle a été faite */
export function doneDates(logs: HabitLog[] | undefined, habitId: number): Set<string> {
  return new Set((logs ?? []).filter((l) => l.habit_id === habitId).map((l) => l.date));
}

/** Fois faite dans la semaine (lundi → dimanche) de ce jour, sans compter le jour `except` */
export function weekCount(done: Set<string>, iso: string, except?: string): number {
  const monday = weekStart(iso);
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    if (d !== except && done.has(d)) n++;
  }
  return n;
}

/**
 * À faire ce jour-là (qu'elle soit déjà cochée ou non) : active et déjà créée, et soit c'est un de ses jours,
 * soit l'objectif de la semaine n'était pas encore atteint (sans compter ce jour-là).
 */
export function isDue(habit: Habit, iso: string, done: Set<string>): boolean {
  const created = createdDay(habit);
  if (!habit.active || (created && iso < created)) return false;
  if (isGoal(habit)) return weekCount(done, iso, iso) < habit.objectif_semaine!;
  return habit.jours.includes(weekday(iso));
}

/**
 * Cette semaine : faites / prévues (ou / objectif).
 * Série : jours prévus faits d'affilée, ou semaines d'affilée où l'objectif est atteint
 * (aujourd'hui, ou la semaine en cours, pas encore fait ne casse pas la série).
 */
export function habitStats(habit: Habit, done: Set<string>, today: string, oldest: string) {
  const created = createdDay(habit);
  const monday = weekStart(today);
  if (isGoal(habit)) {
    const goal = habit.objectif_semaine!;
    let serie = 0;
    for (let m = monday; m >= weekStart(oldest) && (!created || addDays(m, 6) >= created); m = addDays(m, -7)) {
      if (weekCount(done, m) >= goal) serie++;
      else if (m !== monday) break;
    }
    return { faites: weekCount(done, today), prevues: goal, serie };
  }
  let faites = 0;
  let prevues = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    if (done.has(d)) faites++;
    if (habit.jours.includes(i) && (!created || d >= created)) prevues++;
  }
  let serie = 0;
  for (let d = today; d >= oldest && (!created || d >= created); d = addDays(d, -1)) {
    if (!habit.jours.includes(weekday(d))) continue;
    if (done.has(d)) serie++;
    else if (d !== today) break;
  }
  return { faites, prevues, serie };
}
