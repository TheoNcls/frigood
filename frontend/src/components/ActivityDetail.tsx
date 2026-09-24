import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { useActivityTypes } from "../api/queries";
import type { Activity } from "../api/types";
import { activityLabel } from "../lib/activity";
import { formatLong } from "../lib/dates";
import { fmt } from "../lib/nutrition";
import Modal from "./Modal";
import { Spinner } from "./ui";

interface Details {
  disponible: boolean;
  type_key?: string | null;
  lieu?: string | null;
  debut?: string | null;
  description?: string | null;
  duree_s?: number | null;
  duree_mouvement_s?: number | null;
  distance_km?: number | null;
  vitesse_moy_kmh?: number | null;
  vitesse_max_kmh?: number | null;
  allure_s_km?: number | null;
  allure_s_100m?: number | null;
  denivele_pos_m?: number | null;
  denivele_neg_m?: number | null;
  altitude_min_m?: number | null;
  altitude_max_m?: number | null;
  calories?: number | null;
  fc_moy?: number | null;
  fc_max?: number | null;
  zones_fc?: { zone: number; secondes: number }[];
  effet_aerobie?: number | null;
  effet_anaerobie?: number | null;
  effet_libelle?: string | null;
  charge?: number | null;
  vo2max?: number | null;
  cadence_course?: number | null;
  cadence_velo?: number | null;
  foulee_m?: number | null;
  pas?: number | null;
  puissance_moy_w?: number | null;
  puissance_norm_w?: number | null;
  puissance_max_w?: number | null;
  longueurs?: number | null;
  mouvements?: number | null;
  piscine_m?: number | null;
  swolf?: number | null;
  tours?: number | null;
  temperature_min?: number | null;
  temperature_max?: number | null;
  minutes_moderees?: number | null;
  minutes_intenses?: number | null;
  sueur_ml?: number | null;
  body_battery?: number | null;
}

export function duration(s: number | null | undefined): string | null {
  if (!s) return null;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  if (h) return `${h} h ${String(m).padStart(2, "0")}`;
  return sec && m < 10 ? `${m} min ${String(sec).padStart(2, "0")} s` : `${m} min`;
}

function pace(s: number | null | undefined, unit: string): string | null {
  if (!s) return null;
  return `${Math.floor(s / 60)}'${String(Math.round(s % 60)).padStart(2, "0")}" ${unit}`;
}

const ZONE_COLORS = ["#94a3b8", "#38bdf8", "#22c55e", "#f59e0b", "#ef4444"];
const ZONE_LABELS = ["Échauffement", "Facile", "Aérobie", "Seuil", "Maximum"];

function Metric({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-base font-semibold text-slate-900">{value}</div>
      {hint && <div className="text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-sm font-semibold text-slate-700">{title}</div>
      {children}
    </div>
  );
}

function EffectBar({ label, value }: { label: string; value: number | null | undefined }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-slate-600">{label}</span>
        <span className="font-semibold">{fmt(value, 1)} / 5</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.min(value / 5, 1) * 100}%` }} />
      </div>
    </div>
  );
}

const has = (...values: unknown[]) => values.some((v) => v !== null && v !== undefined && v !== 0);

export default function ActivityDetail({ activity, onClose }: { activity: Activity; onClose: () => void }) {
  const types = useActivityTypes();
  const details = useQuery({
    queryKey: ["activity_details", activity.id],
    queryFn: () => api<Details>(`/activities/${activity.id}/details`),
    enabled: activity.source === "garmin",
    staleTime: Infinity,
  });
  const d = details.data;
  const zones = d?.zones_fc ?? [];
  const zonesTotal = zones.reduce((s, z) => s + z.secondes, 0);
  const heure = d?.debut?.slice(11, 16);

  return (
    <Modal title={`${activity.source === "garmin" ? "⌚" : "✏️"} ${activityLabel(activity, types.byId)}`} onClose={onClose} wide>
      <p className="-mt-2 mb-4 text-sm text-slate-500">
        {formatLong(activity.date)}{heure ? ` · ${heure}` : ""}{d?.lieu ? ` · ${d.lieu}` : ""}
      </p>

      {activity.source !== "garmin" ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric label="Durée" value={activity.duree_min ? `${activity.duree_min} min` : null} />
            <Metric label="Distance" value={activity.distance_km ? `${fmt(activity.distance_km, 2)} km` : null} />
            <Metric label="Calories" value={activity.calories ? `${fmt(activity.calories)} kcal` : null} />
            <Metric label="FC moyenne" value={activity.freq_cardiaque_moy ? `${activity.freq_cardiaque_moy} bpm` : null} />
          </div>
          {activity.notes && <p className="text-sm text-slate-600">{activity.notes}</p>}
          <p className="text-xs text-slate-500">Activité saisie à la main : le détail (allure, zones, effet d'entraînement…) n'existe que pour les activités Garmin.</p>
        </div>
      ) : details.isLoading ? (
        <Spinner />
      ) : !d?.disponible ? (
        <p className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-600">
          Le détail de cette activité n'est pas encore enregistré. Il le sera à la prochaine synchronisation Garmin
          (ou avec « Récupérer l'historique » pour une activité ancienne).
        </p>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric label="Durée" value={duration(d.duree_mouvement_s || d.duree_s)} hint={d.duree_mouvement_s && d.duree_s && d.duree_s - d.duree_mouvement_s > 60 ? `${duration(d.duree_s)} au total` : undefined} />
            <Metric label="Distance" value={d.distance_km ? `${fmt(d.distance_km, 2)} km` : null} />
            <Metric label="Allure moyenne" value={pace(d.allure_s_km, "/km") ?? pace(d.allure_s_100m, "/100 m")} />
            <Metric label="Vitesse moyenne" value={!d.allure_s_km && !d.allure_s_100m && d.vitesse_moy_kmh ? `${fmt(d.vitesse_moy_kmh, 1)} km/h` : null} hint={d.vitesse_max_kmh ? `max ${fmt(d.vitesse_max_kmh, 1)} km/h` : undefined} />
            <Metric label="Dénivelé" value={d.denivele_pos_m ? `+${fmt(d.denivele_pos_m)} m` : null} hint={d.denivele_neg_m ? `−${fmt(d.denivele_neg_m)} m` : undefined} />
            <Metric label="Calories" value={d.calories ? `${fmt(d.calories)} kcal` : null} />
            <Metric label="FC moyenne" value={d.fc_moy ? `${d.fc_moy} bpm` : null} hint={d.fc_max ? `max ${d.fc_max} bpm` : undefined} />
            <Metric label="Body battery" value={d.body_battery ? `${d.body_battery > 0 ? "+" : ""}${d.body_battery}` : null} />
          </div>

          {zones.length > 0 && (
            <Section title="Zones cardiaques">
              <div className="space-y-1.5">
                {[1, 2, 3, 4, 5].map((z) => {
                  const s = zones.find((x) => x.zone === z)?.secondes ?? 0;
                  const pct = zonesTotal ? (s / zonesTotal) * 100 : 0;
                  return (
                    <div key={z} className="flex items-center gap-2 text-xs">
                      <span className="w-24 shrink-0 text-slate-600">Z{z} · {ZONE_LABELS[z - 1]}</span>
                      <div className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: ZONE_COLORS[z - 1] }} />
                      </div>
                      <span className="w-24 shrink-0 text-right text-slate-700">{duration(s) ?? "—"} · {fmt(pct)} %</span>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {has(d.effet_aerobie, d.effet_anaerobie, d.charge) && (
            <Section title={`Effet d'entraînement${d.effet_libelle ? ` · ${d.effet_libelle}` : ""}`}>
              <div className="grid gap-3 sm:grid-cols-2">
                <EffectBar label="Aérobie" value={d.effet_aerobie} />
                <EffectBar label="Anaérobie" value={d.effet_anaerobie} />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 text-xs text-slate-600">
                {d.charge ? <span>Charge d'entraînement : <b>{fmt(d.charge)}</b></span> : null}
                {d.vo2max ? <span>VO2 max : <b>{d.vo2max}</b></span> : null}
                {has(d.minutes_moderees, d.minutes_intenses) && (
                  <span>Minutes d'intensité : <b>{fmt((d.minutes_moderees ?? 0) + 2 * (d.minutes_intenses ?? 0))}</b> (modérées + 2 × intenses)</span>
                )}
              </div>
            </Section>
          )}

          {has(d.cadence_course, d.foulee_m, d.pas, d.cadence_velo, d.puissance_moy_w, d.longueurs, d.swolf) && (
            <Section title="Technique">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric label="Cadence" value={d.cadence_course ? `${d.cadence_course} pas/min` : d.cadence_velo ? `${d.cadence_velo} tr/min` : null} />
                <Metric label="Foulée" value={d.foulee_m ? `${fmt(d.foulee_m, 2)} m` : null} />
                <Metric label="Pas" value={d.pas ? fmt(d.pas) : null} />
                <Metric label="Puissance" value={d.puissance_moy_w ? `${d.puissance_moy_w} W` : null} hint={d.puissance_norm_w ? `normalisée ${d.puissance_norm_w} W` : undefined} />
                <Metric label="Longueurs" value={d.longueurs ? `${d.longueurs}${d.piscine_m ? ` × ${d.piscine_m} m` : ""}` : null} />
                <Metric label="SWOLF" value={d.swolf || null} />
                <Metric label="Mouvements" value={d.mouvements ? fmt(d.mouvements) : null} />
              </div>
            </Section>
          )}

          {has(d.temperature_max, d.altitude_max_m, d.sueur_ml, d.tours) && (
            <Section title="Conditions">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Metric label="Température" value={d.temperature_max !== null && d.temperature_max !== undefined ? `${d.temperature_min ?? d.temperature_max}–${d.temperature_max} °C` : null} />
                <Metric label="Altitude" value={d.altitude_max_m ? `${fmt(d.altitude_min_m ?? 0)}–${fmt(d.altitude_max_m)} m` : null} />
                <Metric label="Sueur estimée" value={d.sueur_ml ? `${fmt(d.sueur_ml)} ml` : null} hint="à compenser en eau" />
                <Metric label="Tours" value={d.tours || null} />
              </div>
            </Section>
          )}

          {d.description && <p className="text-sm text-slate-600">{d.description}</p>}
        </div>
      )}
    </Modal>
  );
}
