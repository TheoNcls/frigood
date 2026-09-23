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
