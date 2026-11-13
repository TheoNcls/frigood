import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ClipboardPaste, FileUp, Lock, Sparkles, Trash2 } from "lucide-react";
import { api } from "../api/client";
import type { ActivityType, SeanceStep, StrengthExercise, WorkoutProposal } from "../api/types";
import { useCurrentUser } from "../auth/AuthContext";
import { CoachText } from "./Coach";
import CopyPromptButton from "./CopyPrompt";
import Modal from "./Modal";
import { useToast } from "./Toast";
import { Spinner } from "./ui";

export interface SeanceDraft {
  etapes: SeanceStep[];
  exercices: StrengthExercise[];
}

/** État du formulaire de tâche envoyé avec la demande (sport, date, séance déjà prévue…). */
export interface WorkoutFormState {
  titre: string;
  date: string;
  heure: string;
  notes: string;
  activity_type_id: string;
  task_id?: number;
}

const STRENGTH_WORDS = ["renfo", "muscu", "force", "strength", "gainage", "crossfit"];

/** renforcement, course ou autre : pour l'exemple affiché dans la zone de texte. */
export function sportKind(t: ActivityType | undefined): "renforcement" | "course" | "autre" {
  if (!t) return "autre";
  const nom = t.nom.toLowerCase();
  const key = t.garmin_type_key ?? "";
  if (["strength_training", "indoor_strength", "hiit"].includes(key) || STRENGTH_WORDS.some((w) => nom.includes(w))) return "renforcement";
  if (key.includes("running") || nom.includes("course")) return "course";
  return "autre";
}

const PLACEHOLDERS = {
  renforcement: "Ex. haut du corps, 45 min : développé couché, tractions et rowing ; ajoute 2 exercices pour les épaules. Pas de jambes.",
  course: "Ex. fractionné : 15 min d'échauffement, 10 × 400 m allure 5 km avec 1 min 30 de récup, 10 min retour au calme.",
  autre: "Ex. séance de 45 min, plutôt douce, avec ce que tu veux travailler…",
};

export const hasSeance = (s: SeanceDraft) => s.etapes.length > 0 || s.exercices.length > 0;

/**
 * « Séance IA » du formulaire de tâche : la personne décrit la séance voulue, Claude (ou une autre IA, par
 * copier-coller) la construit ; la proposition remplit le formulaire (rien n'est enregistré avant « Ajouter »).
 */
export default function WorkoutAIPanel({ form, seance, sport, onApply, onClear }: {
  form: WorkoutFormState;
  seance: SeanceDraft;
  sport: ActivityType | undefined;
  onApply: (p: WorkoutProposal) => void;
  onClear: () => void;
}) {
  const user = useCurrentUser();
  const toast = useToast();
  const [demande, setDemande] = useState("");
  const [importing, setImporting] = useState(false);
  const [remarques, setRemarques] = useState("");
  const existing = hasSeance(seance);

  const payload = () => ({
    demande: demande.trim(),
    activity_type_id: form.activity_type_id ? Number(form.activity_type_id) : null,
    date: form.date || null,
    heure: form.heure || null,
    titre: form.titre.trim() || null,
    notes: form.notes.trim() || null,
    task_id: form.task_id ?? null,
    ...(existing ? { etapes: seance.etapes, exercices: seance.exercices } : {}),
  });
  const apply = (p: WorkoutProposal, by: string) => {
    onApply(p);
    setRemarques(p.remarques);
    setDemande("");   // la zone sert ensuite à demander des changements
    toast(`${by} a ${existing ? "modifié" : "créé"} la séance : vérifie-la, puis enregistre la tâche`);
  };

  const claude = useMutation({
    mutationFn: () => api<WorkoutProposal>(`/users/${user.id}/workout_creator/ai`, { method: "POST", body: payload() }),
    onSuccess: (p) => apply(p, "Claude"),
    onError: (e) => toast(e.message, "error"),
  });
  const needText = () => { if (!demande.trim()) { toast("Décris d'abord la séance que tu veux", "error"); return false; } return true; };

  return (
    <div className="space-y-2 rounded-xl border border-violet-200 bg-violet-50/50 p-3">
      {importing && (
        <ImportModal activityTypeId={form.activity_type_id} onClose={() => setImporting(false)}
          onApply={(p) => { setImporting(false); apply(p, "L'IA"); }} />
      )}
      <label className="block text-sm font-medium text-slate-800" htmlFor="seance-demande">
        {existing ? "Ce qu'il faut changer dans la séance" : "La séance que tu veux"}
      </label>
      <textarea id="seance-demande" className="input min-h-[5.5rem] text-sm" value={demande} maxLength={3000}
        onChange={(e) => setDemande(e.target.value)}
        placeholder={existing ? "Ex. remplace les tractions par du rowing, ajoute du gainage à la fin…" : PLACEHOLDERS[sportKind(sport)]} />
      <p className="text-xs text-slate-500">
        {sport ? <>Sport : <b>{sport.nom}</b>. </> : "Choisis le sport au-dessus (sinon l'IA le déduit de ta demande). "}
        Cite les exercices ou blocs que tu veux, et dis si l'IA peut en ajouter. Elle tient compte de ton niveau, de tes zones,
        de ton matériel et des séances prévues autour.
      </p>

      <button type="button" className="btn-primary w-full" disabled={claude.isPending || !user.coach_access}
        onClick={() => needText() && claude.mutate()}>
        {user.coach_access ? <Sparkles className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
        {claude.isPending ? "Claude prépare ta séance…" : existing ? "Modifier avec Claude" : "Créer avec Claude"}
      </button>
      {claude.isPending && <Spinner label="Compte jusqu'à une minute…" />}

      <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-violet-200 pt-2">
        <p className="w-full text-xs text-slate-500">
          {user.coach_access ? "Ou avec une autre IA (ChatGPT, Claude.ai, Gemini…) :" : "Claude n'est pas activé pour ton compte : utilise une autre IA (ChatGPT, Claude.ai, Gemini…) :"}{" "}
          copie le texte, colle-le dans l'IA, puis colle sa réponse ici.
        </p>
        <CopyPromptButton
          className="btn-secondary py-1.5 text-sm"
          load={() => {
            if (!demande.trim()) return Promise.reject(new Error("Décris d'abord la séance que tu veux"));
            return api<{ texte: string }>(`/users/${user.id}/workout_creator/prompt`, { method: "POST", body: payload() }).then((x) => x.texte);
          }}
        />
        <button type="button" className="btn-secondary py-1.5 text-sm" onClick={() => setImporting(true)}>
          <ClipboardPaste className="h-4 w-4" /> Coller la réponse de l'IA
        </button>
      </div>

      {remarques && (
        <div className="rounded-lg bg-white/80 px-2.5 py-2 text-sm">
          <div className="mb-1 text-xs font-semibold text-violet-800">Remarques de l'IA</div>
          <CoachText text={remarques} />
        </div>
      )}
      {existing && (
        <button type="button" className="btn-ghost py-1 text-xs text-red-600" onClick={() => { onClear(); setRemarques(""); }}>
          <Trash2 className="h-3.5 w-3.5" /> Retirer la séance détaillée
        </button>
      )}
    </div>
  );
}

/** Réponse d'une autre IA, collée ou chargée en fichier : relue par le serveur, puis elle remplit le formulaire. */
function ImportModal({ activityTypeId, onClose, onApply }: {
  activityTypeId: string;
  onClose: () => void;
  onApply: (p: WorkoutProposal) => void;
}) {
  const user = useCurrentUser();
  const toast = useToast();
  const [text, setText] = useState("");
  const parse = useMutation({
    mutationFn: () => api<WorkoutProposal>(`/users/${user.id}/workout_creator/parse`, {
      method: "POST", body: { texte: text }, query: activityTypeId ? { activity_type_id: activityTypeId } : undefined,
    }),
    onSuccess: onApply,
    onError: (e) => toast(e.message, "error"),
  });
  return (
    <Modal title="Coller la réponse de l'IA" onClose={onClose}>
      <div className="space-y-3 text-sm">
        <p className="text-slate-600">Colle toute la réponse (le bloc JSON), ou charge son fichier. Elle remplit la tâche : tu pourras tout ajuster avant d'enregistrer.</p>
        <textarea className="input min-h-[12rem] font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)}
          aria-label="Réponse de l'IA" placeholder={"```json\n{ \"titre\": \"…\", \"exercices\": [ … ] }\n```"} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="btn-secondary cursor-pointer">
            <FileUp className="h-4 w-4" /> Charger le fichier
            <input type="file" accept=".json,.txt,application/json,text/plain" className="sr-only"
              onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
          </label>
          <button type="button" className="btn-primary" disabled={!text.trim() || parse.isPending} onClick={() => parse.mutate()}>
            {parse.isPending ? "Lecture…" : "Remplir la tâche"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
