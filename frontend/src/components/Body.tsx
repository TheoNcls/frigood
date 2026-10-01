import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Gauge, Scale } from "lucide-react";
import { api } from "../api/client";
import { useBody, useFitness } from "../api/queries";
import type { BodyComposition, FitnessMetric } from "../api/types";
import { useAuth, useCurrentUser } from "../auth/AuthContext";
import { addDays, formatShort, todayISO } from "../lib/dates";
import { fmt } from "../lib/nutrition";
import { useToast } from "./Toast";
import { Card, Empty, Field, Segmented } from "./ui";

/** Balance (pesées) et indicateurs de forme Garmin. Tout est facultatif : sans balance ni montre compatible, rien ne s'affiche. */

export function formatRaceTime(s: number | null): string | null {
  if (!s) return null;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

function paceLabel(seconds: number | null, km: number): string | null {
  if (!seconds) return null;
  const p = Math.round(seconds / km);
  return `${Math.floor(p / 60)}:${String(p % 60).padStart(2, "0")} /km`;
}

const latest = <T extends { date: string }>(rows: T[] | undefined, pick?: (r: T) => unknown): T | undefined =>
  [...(rows ?? [])].filter((r) => (pick ? pick(r) !== null && pick(r) !== undefined : true)).sort((a, b) => b.date.localeCompare(a.date))[0];

function signed(n: number, decimals = 1) {
  return `${n > 0 ? "+" : n < 0 ? "−" : "±"}${fmt(Math.abs(n), decimals)}`;
}

function readinessColor(score: number) {
  return score >= 75 ? "text-emerald-600" : score >= 50 ? "text-amber-600" : "text-rose-600";
}

function Tile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold leading-tight text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

/** Variation de poids sur une période : pesée la plus proche avant la date de comparaison. */
function weightDelta(rows: BodyComposition[], last: BodyComposition, days: number): number | null {
  const ref = rows.filter((r) => r.date <= addDays(last.date, -days)).sort((a, b) => b.date.localeCompare(a.date))[0];
  return ref ? last.poids_kg - ref.poids_kg : null;
}

/** Accueil : disposition du jour, statut d'entraînement, VO2max et dernier poids. Masquée sans aucune donnée. */
export function FitnessTodayCard() {
  const today = todayISO();
  const fitness = useFitness(addDays(today, -7), today);
  const body = useBody(addDays(today, -60), today);

  const ready = latest(fitness.data, (r) => r.readiness_score);
  const status = latest(fitness.data, (r) => r.statut_entrainement);
  const vo2 = latest(fitness.data, (r) => r.vo2max);
  const rows = body.data ?? [];
  const weight = latest(rows);
  if (!ready && !status && !vo2 && !weight) return null;

  const d7 = weight ? weightDelta(rows, weight, 7) : null;
  const tiles: ReactNode[] = [];
  if (ready?.readiness_score !== null && ready) {
    tiles.push(
      <Tile
        key="ready"
        label={ready.date === today ? "Disposition du jour" : `Disposition (${formatShort(ready.date)})`}
        value={<span className={readinessColor(ready.readiness_score!)}>{ready.readiness_score}<span className="text-sm font-normal text-slate-500">/100</span></span>}
        sub={ready.readiness_niveau}
      />,
    );
  }
  if (status) {
    tiles.push(
      <Tile
        key="status"
        label="Statut d'entraînement"
        value={status.statut_entrainement}
        sub={status.charge_aigue !== null ? `Charge ${status.charge_aigue}${status.charge_chronique ? ` / ${status.charge_chronique} habituelle` : ""}` : undefined}
      />,
    );
  }
  if (vo2) tiles.push(<Tile key="vo2" label="VO2max" value={fmt(vo2.vo2max!, 1)} sub={vo2.vo2max_velo ? `Vélo : ${fmt(vo2.vo2max_velo, 1)}` : undefined} />);
  if (weight) {
    tiles.push(
      <Tile
        key="weight"
        label={weight.date === today ? "Poids du jour" : `Poids (${formatShort(weight.date)})`}
        value={`${fmt(weight.poids_kg, 1)} kg`}
        sub={[d7 !== null ? `${signed(d7)} kg sur 7 j` : null, weight.masse_grasse_pct !== null ? `${fmt(weight.masse_grasse_pct, 1)} % MG` : null].filter(Boolean).join(" · ") || undefined}
      />,
    );
  }

  return (
    <Card title={<span className="inline-flex items-center gap-1.5"><Gauge className="h-4 w-4" /> Forme</span>}>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">{tiles}</div>
    </Card>
  );
}

const RANGES = ["30", "90", "365"] as const;
type Range = (typeof RANGES)[number];

/** Historique : courbe du poids (et de la masse grasse) avec la dernière composition complète. */
export function BodyTrendCard() {
  const [range, setRange] = useState<Range>("90");
  const today = todayISO();
  const body = useBody(addDays(today, -Number(range) + 1), today);
  const rows = body.data ?? [];
  // Rien tant qu'il n'y a pas de pesée (chargement compris) : pas de carte vide qui clignote
  if (!rows.length) return null;

  // Une valeur par jour (dernière pesée du jour)
  const byDay = new Map<string, BodyComposition>();
  for (const r of rows) byDay.set(r.date, r);
  const data = [...byDay.values()].map((r) => ({
    date: formatShort(r.date), poids: r.poids_kg, mg: r.masse_grasse_pct,
  }));
  const last = rows[rows.length - 1];
  const hasFat = data.some((d) => d.mg !== null);
  const weights = data.map((d) => d.poids);
  const min = Math.floor(Math.min(...weights) - 1);
  const max = Math.ceil(Math.max(...weights) + 1);

  return (
    <Card
      title={<span className="inline-flex items-center gap-1.5"><Scale className="h-4 w-4" /> Poids & composition</span>}
      action={<Segmented value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r, label: r === "365" ? "1 an" : `${r} j` }))} />}
    >
      {last && (
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Tile label={`Dernière pesée (${formatShort(last.date)})`} value={`${fmt(last.poids_kg, 1)} kg`} sub={last.imc ? `IMC ${fmt(last.imc, 1)}` : undefined} />
          {last.masse_grasse_pct !== null && <Tile label="Masse grasse" value={`${fmt(last.masse_grasse_pct, 1)} %`} />}
          {last.masse_musculaire_kg !== null && <Tile label="Masse musculaire" value={`${fmt(last.masse_musculaire_kg, 1)} kg`} />}
          {last.eau_pct !== null && <Tile label="Eau corporelle" value={`${fmt(last.eau_pct, 1)} %`} />}
          {last.masse_osseuse_kg !== null && <Tile label="Masse osseuse" value={`${fmt(last.masse_osseuse_kg, 1)} kg`} />}
          {last.graisse_viscerale !== null && <Tile label="Graisse viscérale" value={fmt(last.graisse_viscerale, 0)} />}
          {last.age_metabolique !== null && <Tile label="Âge métabolique" value={`${last.age_metabolique} ans`} />}
        </div>
      )}
      {data.length > 1 ? (
        <div className="h-56 w-full">
          <ResponsiveContainer>
            <ComposedChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} minTickGap={16} />
              <YAxis yAxisId="kg" domain={[min, max]} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
              {hasFat && <YAxis yAxisId="mg" orientation="right" domain={["auto", "auto"]} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />}
              <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line yAxisId="kg" dataKey="poids" name="Poids (kg)" stroke="#0f766e" strokeWidth={2} dot={{ r: 2 }} connectNulls />
              {hasFat && <Line yAxisId="mg" dataKey="mg" name="Masse grasse (%)" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} connectNulls />}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <Empty>Une seule pesée sur la période : la courbe apparaîtra avec la suivante.</Empty>
      )}
    </Card>
  );
}

/** Historique : VO2max, disposition et prédictions de course. Masquée si la montre ne fournit rien. */
export function FitnessTrendCard() {
  const today = todayISO();
  const fitness = useFitness(addDays(today, -89), today);
  const rows = fitness.data ?? [];
  const useful = rows.filter((r) => r.vo2max !== null || r.readiness_score !== null);
  const last: FitnessMetric | undefined = latest(rows, (r) => r.prediction_5k_s);
  const scores = latest(rows, (r) => r.endurance_score ?? r.hill_score ?? r.age_forme);
  if (!useful.length && !last && !scores) return null;

  const data = useful.map((r) => ({ date: formatShort(r.date), vo2: r.vo2max, dispo: r.readiness_score }));
  const races: [string, number | null, number][] = last
    ? [["5 km", last.prediction_5k_s, 5], ["10 km", last.prediction_10k_s, 10], ["Semi", last.prediction_semi_s, 21.0975], ["Marathon", last.prediction_marathon_s, 42.195]]
    : [];

  return (
    <Card title={<span className="inline-flex items-center gap-1.5"><Gauge className="h-4 w-4" /> Forme & entraînement (90 j)</span>}>
      {data.length > 1 && (
        <div className="mb-4 h-52 w-full">
          <ResponsiveContainer>
            <ComposedChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} minTickGap={16} />
              <YAxis yAxisId="vo2" domain={["auto", "auto"]} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
              <YAxis yAxisId="dispo" orientation="right" domain={[0, 100]} tick={{ fontSize: 11, fill: "#64748b" }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line yAxisId="vo2" dataKey="vo2" name="VO2max" stroke="#ea580c" strokeWidth={2} dot={{ r: 2 }} connectNulls />
              <Line yAxisId="dispo" dataKey="dispo" name="Disposition" stroke="#6366f1" strokeWidth={1.5} dot={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {races.some(([, s]) => s) && (
          <div>
            <div className="mb-1.5 text-sm font-semibold text-slate-700">Prédictions de course</div>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {races.filter(([, s]) => s).map(([label, s, km]) => (
                  <tr key={label}>
                    <td className="py-1.5 text-slate-600">{label}</td>
                    <td className="py-1.5 text-right font-medium text-slate-900">{formatRaceTime(s)}</td>
                    <td className="py-1.5 pl-3 text-right text-xs text-slate-500">{paceLabel(s, km)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {scores && (
          <div className="grid grid-cols-2 gap-2 self-start">
            {scores.endurance_score !== null && <Tile label="Endurance" value={fmt(scores.endurance_score)} />}
            {scores.hill_score !== null && <Tile label="Côtes (hill score)" value={scores.hill_score} />}
            {scores.age_forme !== null && <Tile label="Âge physique" value={`${fmt(scores.age_forme, 1)} ans`} />}
          </div>
        )}
      </div>
    </Card>
  );
}

/** Profil : pesées. Avec une balance Garmin elles arrivent seules ; sinon, saisie à la main. */
export function WeighInsCard() {
  const user = useCurrentUser();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { refreshUser } = useAuth();
  const body = useBody(addDays(todayISO(), -365), todayISO());
  const [f, setF] = useState({ date: todayISO(), poids: "", mg: "" });
  const rows = [...(body.data ?? [])].reverse();
  const hasGarmin = rows.some((r) => r.source === "garmin");
  // Pesée déjà enregistrée ce jour-là (la plus récente) : affichée, et modifiable
  const existing = rows.find((r) => r.date === f.date);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const key = existing ? `${existing.id}-${existing.poids_kg}-${existing.masse_grasse_pct}` : `none-${f.date}`;
  if (body.data && loadedFor !== key) {
    setLoadedFor(key);
    setF((x) => ({
      ...x,
      poids: existing ? fmt(existing.poids_kg, 2) : "",
      mg: existing?.masse_grasse_pct !== null && existing?.masse_grasse_pct !== undefined ? fmt(existing.masse_grasse_pct, 1) : "",
    }));
  }
  const num = (v: string) => parseFloat(v.replace(",", "."));
  const changed = existing
    ? num(f.poids) !== existing.poids_kg || (f.mg ? num(f.mg) : null) !== existing.masse_grasse_pct
    : !!f.poids;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["body"] });
    await refreshUser();  // l'objectif protéines en g/kg suit le dernier poids
  };
  const add = useMutation({
    mutationFn: () => {
      const values = { poids_kg: num(f.poids), masse_grasse_pct: f.mg ? num(f.mg) : null };
      return existing
        ? api(`/body/${existing.id}`, { method: "PUT", body: values })
        : api(`/users/${user.id}/body/`, { method: "POST", body: { date: f.date, ...values } });
    },
    onSuccess: async () => { toast(existing ? "Pesée modifiée" : "Pesée enregistrée"); await refresh(); },
    onError: (e) => toast(e.message, "error"),
  });

  return (
    <Card title={<span className="inline-flex items-center gap-1.5"><Scale className="h-4 w-4" /> Poids</span>}>
      <p className="mb-3 text-sm text-slate-600">
        {hasGarmin
          ? "Tes pesées arrivent de ta balance Garmin à chaque synchro. Tu peux aussi en ajouter à la main."
          : "Avec une balance Garmin, les pesées arrivent toutes seules à la synchro. Sans balance, note ton poids ici."}
      </p>
      <form
        className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:items-end"
        onSubmit={(e: FormEvent) => { e.preventDefault(); if (f.poids) add.mutate(); }}
      >
        <Field label="Date"><input className="input" type="date" required max={todayISO()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label="Poids (kg)"><input className="input" inputMode="decimal" required placeholder="72,4" value={f.poids} onChange={(e) => setF({ ...f, poids: e.target.value })} /></Field>
        <Field label="Masse grasse (%)"><input className="input" inputMode="decimal" placeholder="facultatif" value={f.mg} onChange={(e) => setF({ ...f, mg: e.target.value })} /></Field>
        <button type="submit" className="btn-primary" disabled={add.isPending || !f.poids || !changed}>
          {existing ? "Modifier" : "Ajouter"}
        </button>
      </form>
      {existing && (
        <p className="mt-2 text-xs text-slate-500">
          Pesée du {formatShort(existing.date)} déjà enregistrée
          {existing.source === "garmin" ? (existing.modifie ? " (balance, corrigée à la main)" : " (balance)") : ""} :
          tu peux corriger le poids et la masse grasse.
          {existing.source === "garmin" && " Ta correction ne sera pas écrasée par la synchro."}
        </p>
      )}
    </Card>
  );
}

/** Objectif protéines en g/kg : utilisé par le formulaire d'objectifs du Profil. */
export function useLatestWeight(): number | null {
  const today = todayISO();
  const body = useBody(addDays(today, -365), today);
  return latest(body.data)?.poids_kg ?? null;
}

