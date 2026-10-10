import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, api } from "../api/client";
import { duration, pace } from "../lib/activity";
import { fmt } from "../lib/nutrition";
import { Segmented, Spinner } from "./ui";

type LapType = "echauffement" | "effort" | "recuperation" | "retour_au_calme" | "tour";
type Verdict = "ok" | "lent" | "rapide" | "bas" | "haut";

interface Planned {
  type: LapType;
  duree_s: number | null;
  distance_m: number | null;
  allure_s_km: number | null;
  zone_fc: number | null;
  repetition?: string | null;
}

interface Lap {
  numero: number;
  type: LapType;
  distance_m: number | null;
  duree_s: number | null;
  allure_s_km: number | null;
  allure_ajustee_s_km: number | null;
  vitesse_kmh: number | null;
  fc_moy: number | null;
  fc_max: number | null;
  cadence: number | null;
  d_plus: number | null;
  d_moins: number | null;
  puissance_w: number | null;
  prevu?: Planned;
  verdict?: Verdict | null;
}

interface LapsResponse {
  statut: "ok" | "a_recuperer" | "indisponible";
  tours: Lap[];
  seance?: { titre: string; etapes: number; correspondance: boolean; marge_allure_s: number } | null;
}

const TYPES: Record<LapType, { label: string; color: string }> = {
  echauffement: { label: "Échauffement", color: "#94a3b8" },
  effort: { label: "Effort", color: "#f97316" },
  recuperation: { label: "Récupération", color: "#38bdf8" },
  retour_au_calme: { label: "Retour au calme", color: "#cbd5e1" },
  tour: { label: "Tour", color: "#10b981" },
};

const VERDICTS: Record<Verdict, { label: string; good: boolean }> = {
  ok: { label: "✓ dans la cible", good: true },
  lent: { label: "plus lent que la cible", good: false },
  rapide: { label: "plus rapide que la cible", good: false },
  bas: { label: "FC sous la zone visée", good: false },
  haut: { label: "FC au-dessus de la zone visée", good: false },
};

const km = (m: number | null) => (m ? (m >= 1000 ? `${fmt(m / 1000, 2)} km` : `${fmt(m)} m`) : null);

function plannedLabel(p: Planned, margin: number): string {
  const what = p.distance_m ? km(p.distance_m) : p.duree_s ? duration(p.duree_s) : "jusqu'au bouton Lap";
  const target = p.allure_s_km ? ` à ${pace(p.allure_s_km)}/km (±${margin} s)` : p.zone_fc ? ` en zone ${p.zone_fc}` : "";
  return `${TYPES[p.type]?.label ?? p.type}${p.repetition ? ` ${p.repetition}` : ""} : ${what}${target}`;
}

function errorText(e: Error): string {
  if (e instanceof ApiError && e.message === "GARMIN_BLOQUE") return "Garmin bloque les appels du serveur pour le moment : réessaie plus tard.";
  if (e instanceof ApiError && e.message === "SESSION_GARMIN_EXPIREE") return "Session Garmin expirée : reconnecte-toi dans le Profil.";
  return e.message;
}

/**
 * Tours (segments) d'une activité Garmin en bâtons : largeur = durée, hauteur = allure (ou FC), couleur = type d'étape.
 * Récupérés sur Garmin à la première ouverture seulement, puis lus en base.
 */
export default function ActivityLaps({ activityId }: { activityId: number }) {
  const laps = useQuery({
    queryKey: ["activity_laps", activityId],
    queryFn: async () => {
      const r = await api<LapsResponse>(`/activities/${activityId}/laps`);
      return r.statut === "a_recuperer" ? api<LapsResponse>(`/activities/${activityId}/laps`, { method: "POST" }) : r;
    },
    staleTime: Infinity,
    retry: false,
  });
  const [metric, setMetric] = useState<"allure" | "fc">("allure");
  const [picked, setPicked] = useState<number | null>(null);

  if (laps.isLoading) return <Section><Spinner label="Récupération des tours sur Garmin…" /></Section>;
  if (laps.error) {
    return (
      <Section>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
          <span>Tours non récupérés : {errorText(laps.error)}</span>
          <button type="button" className="btn-ghost text-xs" onClick={() => laps.refetch()}>Réessayer</button>
        </div>
      </Section>
    );
  }
  const data = laps.data;
  const tours = data?.tours ?? [];
  if (data?.statut !== "ok" || tours.length < 2) return null;

  const paceSport = tours.some((t) => t.allure_s_km);
  const structured = tours.some((t) => t.type !== "tour");
  const seance = data.seance;
  const value = (t: Lap) => (metric === "fc" ? t.fc_moy : t.vitesse_kmh) ?? 0;
  const values = tours.map(value).filter((v) => v > 0);
  const max = Math.max(...values, 1);
  // Base sous le plus lent : les écarts restent lisibles sans exagérer de petites différences
  const low = Math.min(...values, max) * 0.6;
  const height = (t: Lap) => (value(t) > 0 ? 8 + (92 * (value(t) - low)) / (max - low || 1) : 3);
  const total = tours.reduce((s, t) => s + (t.duree_s ?? 0), 0);
  const selectedIndex = picked ?? Math.max(tours.findIndex((t) => t.type === "effort"), 0);
  const selected = tours[selectedIndex];

  const efforts = tours.filter((t) => t.type === "effort");
  const effortTime = efforts.reduce((s, t) => s + (t.duree_s ?? 0), 0);
  const effortDist = efforts.reduce((s, t) => s + (t.distance_m ?? 0), 0);
  const effortHr = effortTime ? efforts.reduce((s, t) => s + (t.fc_moy ?? 0) * (t.duree_s ?? 0), 0) / effortTime : 0;
  const judged = efforts.filter((t) => t.verdict);
  const showDPlus = tours.some((t) => (t.d_plus ?? 0) >= 5);
  const typesShown = [...new Set(tours.map((t) => t.type))];

  return (
    <Section>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
            {typesShown.map((t) => (
              <span key={t} className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: TYPES[t].color }} /> {TYPES[t].label}
              </span>
            ))}
          </div>
          <Segmented
            value={metric}
            onChange={(m) => setMetric(m)}
            options={[{ value: "allure", label: paceSport ? "Allure" : "Vitesse" }, { value: "fc", label: "FC" }]}
          />
        </div>

        <div>
          <div className="flex h-40 items-end gap-px" role="group" aria-label="Tours en bâtons">
            {tours.map((t, i) => (
              <button
                key={t.numero}
                type="button"
                aria-label={`Tour ${t.numero}`}
                aria-pressed={i === selectedIndex}
                onClick={() => setPicked(i)}
                className={`min-w-[3px] rounded-t-sm transition-opacity ${i === selectedIndex ? "opacity-100 ring-2 ring-slate-800 ring-offset-1" : "opacity-80 hover:opacity-100"}`}
                style={{ flexGrow: t.duree_s || 1, flexBasis: 0, height: `${height(t)}%`, background: TYPES[t.type].color }}
              />
            ))}
          </div>
          {seance?.correspondance && (
            <div className="mt-1 flex gap-px" aria-hidden>
              {tours.map((t) => (
                <div key={t.numero} className="flex min-w-[3px] justify-center" style={{ flexGrow: t.duree_s || 1, flexBasis: 0 }}>
                  {t.verdict && <span className={`h-1.5 w-1.5 rounded-full ${VERDICTS[t.verdict].good ? "bg-emerald-500" : "bg-amber-500"}`} />}
                </div>
              ))}
            </div>
          )}
          <div className="mt-1 flex justify-between text-[11px] text-slate-400">
            <span>0</span>
            <span>{metric === "fc" ? "plus haut = FC plus élevée" : "plus haut = plus rapide"}</span>
            <span>{duration(total)}</span>
          </div>
        </div>

        {selected && <LapCard lap={selected} paceSport={paceSport} margin={seance?.marge_allure_s ?? 10} />}

        {structured && efforts.length > 1 && (
          <p className="text-sm text-slate-700">
            <b>{efforts.length} efforts</b>
            {effortDist ? ` · ${km(effortDist)}` : ""}
            {` · ${duration(effortTime)}`}
            {paceSport && effortDist && effortTime ? ` · allure moyenne ${pace((effortTime / effortDist) * 1000)}/km` : ""}
            {effortHr ? ` · FC moyenne ${fmt(effortHr)}` : ""}
            {judged.length > 0 && ` · dans la cible ${judged.filter((t) => t.verdict === "ok").length}/${judged.length}`}
          </p>
        )}
        {seance && (
          <p className="text-xs text-slate-500">
            {seance.correspondance
              ? <>Comparé à la séance prévue « {seance.titre} » ({seance.etapes} étapes) : point vert = dans la cible, orange = à côté.</>
              : <>Séance prévue ce jour-là : « {seance.titre} » ({seance.etapes} étapes). Les tours ne suivent pas ses étapes une à une
                (séance pas lancée depuis la montre, tour manuel ou arrêt en cours) : pas de comparaison.</>}
          </p>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="py-1 pr-2 font-medium">#</th>
                <th className="py-1 pr-2 font-medium">Distance</th>
                <th className="py-1 pr-2 font-medium">Temps</th>
                <th className="py-1 pr-2 font-medium">{paceSport ? "Allure" : "Vitesse"}</th>
                <th className="py-1 pr-2 font-medium">FC</th>
                {showDPlus && <th className="py-1 font-medium">D+</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tours.map((t, i) => (
                <tr key={t.numero} onClick={() => setPicked(i)} className={`cursor-pointer ${i === selectedIndex ? "bg-slate-50 font-semibold" : ""}`}>
                  <td className="py-1.5 pr-2">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-sm" style={{ background: TYPES[t.type].color }} />{t.numero}
                    </span>
                  </td>
                  <td className="py-1.5 pr-2">{km(t.distance_m) ?? "—"}</td>
                  <td className="py-1.5 pr-2">{duration(t.duree_s) ?? "—"}</td>
                  <td className="py-1.5 pr-2">
                    {paceSport ? pace(t.allure_s_km) ?? "—" : t.vitesse_kmh ? `${fmt(t.vitesse_kmh, 1)} km/h` : "—"}
                    {!t.prevu?.zone_fc && <VerdictMark verdict={t.verdict} />}
                  </td>
                  <td className="py-1.5 pr-2">
                    {t.fc_moy ?? "—"}
                    {/* Cible en zone cardiaque : le verdict porte sur la FC */}
                    {t.prevu?.zone_fc ? <VerdictMark verdict={t.verdict} /> : null}
                  </td>
                  {showDPlus && <td className="py-1.5">{t.d_plus ? `+${fmt(t.d_plus)}` : "—"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  );
}

function VerdictMark({ verdict }: { verdict?: Verdict | null }) {
  if (!verdict) return null;
  const good = VERDICTS[verdict].good;
  return <span className={good ? "text-emerald-600" : "text-amber-600"} title={VERDICTS[verdict].label}> {good ? "✓" : "•"}</span>;
}

function Section({ children }: { children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-sm font-semibold text-slate-700">Segments</div>
      {children}
    </div>
  );
}

function LapCard({ lap, paceSport, margin }: { lap: Lap; paceSport: boolean; margin: number }) {
  const items = [
    km(lap.distance_m),
    duration(lap.duree_s),
    paceSport ? (lap.allure_s_km ? `${pace(lap.allure_s_km)}/km` : null) : lap.vitesse_kmh ? `${fmt(lap.vitesse_kmh, 1)} km/h` : null,
    lap.allure_ajustee_s_km && lap.allure_ajustee_s_km !== lap.allure_s_km ? `ajustée pente ${pace(lap.allure_ajustee_s_km)}` : null,
    lap.fc_moy ? `FC ${lap.fc_moy}${lap.fc_max ? ` (max ${lap.fc_max})` : ""}` : null,
    lap.cadence ? `${lap.cadence} ${paceSport ? "pas/min" : "tr/min"}` : null,
    lap.puissance_w ? `${lap.puissance_w} W` : null,
    lap.d_plus || lap.d_moins ? `+${fmt(lap.d_plus ?? 0)} / −${fmt(lap.d_moins ?? 0)} m` : null,
  ].filter(Boolean);
  const verdict = lap.verdict ? VERDICTS[lap.verdict] : null;
  const gap = lap.prevu?.allure_s_km && lap.allure_s_km ? Math.abs(lap.allure_s_km - lap.prevu.allure_s_km) : 0;
  const verdictText = verdict && (lap.verdict === "lent" || lap.verdict === "rapide") && gap
    ? `${gap} s/km ${lap.verdict === "lent" ? "plus lent" : "plus rapide"} que la cible` : verdict?.label;
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
      <div className="font-semibold text-slate-900">
        Tour {lap.numero}{lap.type !== "tour" ? ` · ${TYPES[lap.type].label}` : ""}{lap.prevu?.repetition ? ` ${lap.prevu.repetition}` : ""}
      </div>
      <div className="text-slate-700">{items.join(" · ")}</div>
      {lap.prevu && (
        <div className="mt-0.5 text-xs text-slate-500">
          Prévu : {plannedLabel(lap.prevu, margin)}
          {verdict && <span className={verdict.good ? "text-emerald-700" : "text-amber-700"}> → {verdictText}</span>}
        </div>
      )}
    </div>
  );
}
