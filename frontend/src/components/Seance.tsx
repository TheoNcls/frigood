import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Watch } from "lucide-react";
import { ApiError, api } from "../api/client";
import type { SeanceSimpleStep, SeanceStep, StrengthExercise, TaskOccurrence } from "../api/types";
import { useToast } from "./Toast";
import { useInvalidateTasks } from "./Tasks";

const STEP_LABELS: Record<string, string> = {
  echauffement: "Échauffement", effort: "Effort", recuperation: "Récupération", retour_au_calme: "Retour au calme",
};

function pace(s: number) {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}/km`;
}

function stepText(s: SeanceSimpleStep) {
  const parts: string[] = [];
  if (s.distance_m) parts.push(s.distance_m >= 1000 ? `${(s.distance_m / 1000).toLocaleString("fr-FR")} km` : `${s.distance_m} m`);
  else if (s.duree_s) parts.push(s.duree_s % 60 ? `${Math.floor(s.duree_s / 60)} min ${s.duree_s % 60} s` : `${s.duree_s / 60} min`);
  else parts.push("jusqu'au bouton Lap");
  if (s.zone_fc) parts.push(`Z${s.zone_fc}`);
  else if (s.allure_s_km) parts.push(pace(s.allure_s_km));
  return parts.join(" · ");
}

const ZONE_COLORS = ["", "bg-slate-300", "bg-sky-400", "bg-emerald-500", "bg-amber-500", "bg-rose-500"];

function StepLine({ s }: { s: SeanceSimpleStep }) {
  return (
    <li className="flex items-center gap-2">
      <span className={`h-2 w-2 shrink-0 rounded-full ${ZONE_COLORS[s.zone_fc ?? 0] || "bg-slate-400"}`} />
      <span className="font-medium text-slate-800">{STEP_LABELS[s.type] ?? s.type}</span>
      <span className="text-slate-500">{stepText(s)}</span>
    </li>
  );
}

/** Séance structurée : étapes, blocs répétés et cibles (zone cardiaque ou allure). */
export function SeanceSteps({ steps }: { steps: SeanceStep[] }) {
  return (
    <ol className="space-y-1 text-xs">
      {steps.map((s, i) => s.type === "repetition" ? (
        <li key={i} className="rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-1.5">
          <div className="mb-1 font-semibold text-slate-700">{s.repetitions} ×</div>
          <ul className="space-y-1 pl-1">{s.etapes.map((e, j) => <StepLine key={j} s={e} />)}</ul>
        </li>
      ) : <StepLine key={i} s={s} />)}
    </ol>
  );
}

/** Séance de renforcement : exercices, séries, répétitions (ou durée), charge et repos. */
export function ExercisesList({ exercises }: { exercises: StrengthExercise[] }) {
  return (
    <ol className="space-y-1 text-xs">
      {exercises.map((e, i) => (
        <li key={i} className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium text-slate-800">{e.exercice}</span>
          <span className="text-slate-500">
            {e.series} × {e.duree_s ? `${e.duree_s} s` : `${e.repetitions} rép.`}
            {e.charge_kg ? ` · ${e.charge_kg.toLocaleString("fr-FR")} kg` : ""}
            {e.repos_s ? ` · repos ${e.repos_s} s` : ""}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** Envoi (ou retrait) de la séance sur la montre via Garmin Connect. */
export function GarminSendButton({ task }: { task: TaskOccurrence }) {
  const toast = useToast();
  const invalidate = useInvalidateTasks();
  // La fiche garde l'occurrence ouverte : l'état d'envoi est suivi ici
  const [sent, setSent] = useState(task.garmin_envoye);
  const message = (e: Error) =>
    e instanceof ApiError && e.message === "GARMIN_BLOQUE" ? "Garmin bloque les appels du serveur, réessaie plus tard"
      : e instanceof ApiError && e.message === "SESSION_GARMIN_EXPIREE" ? "Session Garmin expirée : reconnecte-toi dans le Profil"
        : e.message;
  const send = useMutation({
    mutationFn: () => api(`/tasks/${task.task_id}/garmin`, { method: "POST" }),
    onSuccess: () => { setSent(true); invalidate(); toast("Séance programmée : elle arrivera sur ta montre à la prochaine synchro"); },
    onError: (e) => toast(message(e), "error"),
  });
  const remove = useMutation({
    mutationFn: () => api(`/tasks/${task.task_id}/garmin`, { method: "DELETE" }),
    onSuccess: () => { setSent(false); invalidate(); toast("Séance retirée de Garmin"); },
    onError: (e) => toast(message(e), "error"),
  });
  const busy = send.isPending || remove.isPending;

  return sent ? (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700"><Watch className="h-4 w-4" /> Programmée sur ta montre</span>
      <button type="button" className="btn-ghost py-1 text-xs" disabled={busy} onClick={() => send.mutate()}>Renvoyer</button>
      <button type="button" className="btn-ghost py-1 text-xs text-red-600" disabled={busy} onClick={() => remove.mutate()}>Retirer</button>
    </div>
  ) : (
    <button type="button" className="btn-secondary" disabled={busy} onClick={() => send.mutate()}>
      <Watch className="h-4 w-4" /> {send.isPending ? "Envoi à Garmin…" : "Envoyer sur ma montre"}
    </button>
  );
}
