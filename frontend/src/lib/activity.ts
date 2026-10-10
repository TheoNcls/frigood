import type { Activity, ActivityType } from "../api/types";
import { fmt } from "./nutrition";

export function activityLabel(a: Activity, types: Map<number, ActivityType>): string {
  return (a.activity_type_id ? types.get(a.activity_type_id)?.nom : undefined) ?? a.notes ?? "Activité";
}

export function activityDetails(a: Activity, { hr = true } = {}): string {
  const parts: string[] = [];
  if (a.duree_min) parts.push(`${a.duree_min} min`);
  if (a.distance_km) parts.push(`${fmt(a.distance_km, 2)} km`);
  if (a.calories) parts.push(`${fmt(a.calories)} kcal`);
  if (hr && a.freq_cardiaque_moy) parts.push(`FC ${a.freq_cardiaque_moy} bpm`);
  return parts.join(" · ");
}

export function duration(s: number | null | undefined): string | null {
  if (!s) return null;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  if (h) return `${h} h ${String(m).padStart(2, "0")}`;
  return sec && m < 10 ? `${m} min ${String(sec).padStart(2, "0")} s` : `${m} min`;
}

/** Allure 4'32" (secondes par km ou par 100 m). */
export function pace(s: number | null | undefined, unit = ""): string | null {
  if (!s) return null;
  const sec = Math.round(s);
  return `${Math.floor(sec / 60)}'${String(sec % 60).padStart(2, "0")}"${unit ? ` ${unit}` : ""}`;
}

/** Chrono 22:35 ou 1:02:10. */
export function clock(s: number): string {
  const t = Math.round(s);
  const h = Math.floor(t / 3600);
  const mm = String(Math.floor((t % 3600) / 60)).padStart(h ? 2 : 1, "0");
  const ss = String(t % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
