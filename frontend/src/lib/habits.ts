import type { Habit } from "../api/types";
import { addDays, parseISODate, toISODate } from "./dates";

/** 0 = lundi … 6 = dimanche (comme le serveur) */
export const DAY_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

export function weekday(iso: string): number {
  return (parseISODate(iso).getDay() + 6) % 7;
}

export function isPlanned(habit: Habit, iso: string): boolean {
  return habit.jours.includes(weekday(iso));
}

export function habitLabel(habit: Habit): string {
  return habit.emoji ? `${habit.emoji} ${habit.nom}` : habit.nom;
}

/** Jour (heure locale) où l'habitude a été créée : avant, rien n'était prévu. */
export function createdDay(habit: Habit): string | null {
  if (!habit.created_at) return null;
  const s = habit.created_at;
  return toISODate(new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`));
}

/** Prévue ce jour-là : active, jour coché, et déjà créée. */
export function isDue(habit: Habit, iso: string): boolean {
  const created = createdDay(habit);
  return habit.active && isPlanned(habit, iso) && (!created || iso >= created);
}

/**
 * Cette semaine (lundi → dimanche) : faites / prévues ; série : jours prévus faits d'affilée jusqu'à aujourd'hui
 * (aujourd'hui pas encore fait ne casse pas la série : la journée n'est pas finie).
 */
export function habitStats(habit: Habit, done: Set<string>, today: string, oldest: string) {
  const monday = addDays(today, -weekday(today));
  const created = createdDay(habit);
  let faites = 0;
  let prevues = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    if (done.has(d)) faites++;
    if (isPlanned(habit, d) && (!created || d >= created)) prevues++;
  }
  let serie = 0;
  for (let d = today; d >= oldest && (!created || d >= created); d = addDays(d, -1)) {
    if (!isPlanned(habit, d)) continue;
    if (done.has(d)) serie++;
    else if (d !== today) break;
  }
  return { faites, prevues, serie };
}
