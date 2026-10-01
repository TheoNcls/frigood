import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Activity as ActivityIcon, ListTodo } from "lucide-react";
import { api } from "../api/client";
import { useActivityTypes } from "../api/queries";
import { useCurrentUser } from "../auth/AuthContext";
import { formatLong, todayISO } from "../lib/dates";
import { useInvalidateSport } from "./Garmin";
import Modal from "./Modal";
import { TaskFormBody } from "./Tasks";
import { useToast } from "./Toast";
import { Field, Segmented } from "./ui";

export type EntryTab = "tache" | "activite";

/**
 * Fenêtre d'ajout d'un jour : onglets « Tâche » et « Activité ».
 * Par défaut : activité pour aujourd'hui ou un jour passé (ce qu'on a fait), tâche pour un jour futur (ce qu'on prévoit).
 * Pas d'activité dans le futur : l'onglet n'apparaît pas.
 */
export default function AddEntryModal({ date, onClose, initialTab }: { date: string; onClose: () => void; initialTab?: EntryTab }) {
  const future = date > todayISO();
  const [tab, setTab] = useState<EntryTab>(future ? "tache" : initialTab ?? "activite");

  return (
    <Modal title={`Ajouter · ${formatLong(date)}`} onClose={onClose}>
      {!future && (
        <div className="mb-4">
          <Segmented
            full
            value={tab}
            onChange={setTab}
            options={[
              { value: "activite", label: <span className="inline-flex items-center gap-1.5"><ActivityIcon className="h-4 w-4" /> Activité</span> },
              { value: "tache", label: <span className="inline-flex items-center gap-1.5"><ListTodo className="h-4 w-4" /> Tâche</span> },
            ]}
          />
        </div>
      )}
      {tab === "tache" ? <TaskFormBody date={date} onClose={onClose} /> : <ActivityFormBody date={date} onDone={onClose} />}
    </Modal>
  );
}

/** Activité saisie à la main (sans montre). */
export function ActivityFormBody({ date, onDone }: { date: string; onDone: () => void }) {
  const user = useCurrentUser();
  const types = useActivityTypes();
  const toast = useToast();
  const invalidate = useInvalidateSport();
  const [f, setF] = useState({ date, type: "", duree: "30", calories: "", distance: "", fc: "", notes: "" });
  const set = (key: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [key]: e.target.value });

  const add = useMutation({
    mutationFn: () => {
      const num = (v: string) => (v && parseFloat(v) > 0 ? parseFloat(v) : null);
      return api(`/users/${user.id}/activities/`, {
        method: "POST",
        body: {
          date: f.date,
          activity_type_id: f.type ? Number(f.type) : null,
          source: "manual",
          duree_min: num(f.duree) && Math.round(num(f.duree)!),
          calories: num(f.calories),
          distance_km: num(f.distance),
          freq_cardiaque_moy: num(f.fc) && Math.round(num(f.fc)!),
          notes: f.notes.trim() || null,
        },
      });
    },
    onSuccess: () => {
      invalidate();
      toast("Activité ajoutée !");
      onDone();
    },
    onError: (e) => toast(e.message, "error"),
  });

  return (
    <form className="grid grid-cols-2 gap-3" onSubmit={(e: FormEvent) => { e.preventDefault(); add.mutate(); }}>
      <Field label="Date">
        <input className="input" type="date" required max={todayISO()} value={f.date} onChange={set("date")} />
      </Field>
      <Field label="Type">
        <select className="input" value={f.type} onChange={set("type")}>
          <option value="">(non défini)</option>
          {types.list.map((t) => <option key={t.id} value={t.id}>{t.nom}</option>)}
        </select>
      </Field>
      <Field label="Durée (min)"><input className="input" type="number" min={0} value={f.duree} onChange={set("duree")} /></Field>
      <Field label="Calories brûlées"><input className="input" type="number" min={0} value={f.calories} onChange={set("calories")} /></Field>
      <Field label="Distance (km)"><input className="input" type="number" min={0} step="any" value={f.distance} onChange={set("distance")} /></Field>
      <Field label="FC moyenne (bpm)"><input className="input" type="number" min={0} value={f.fc} onChange={set("fc")} /></Field>
      <div className="col-span-2">
        <Field label="Notes"><input className="input" value={f.notes} onChange={set("notes")} /></Field>
      </div>
      <p className="col-span-2 text-xs text-slate-500">Les activités de ta montre arrivent toutes seules avec la synchro Garmin.</p>
      <div className="col-span-2 flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onDone}>Annuler</button>
        <button type="submit" className="btn-primary" disabled={add.isPending}>Ajouter</button>
      </div>
    </form>
  );
}
