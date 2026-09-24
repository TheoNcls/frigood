import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Pencil } from "lucide-react";
import { api } from "../api/client";
import { useActivityTypes } from "../api/queries";
import type { ActivityType } from "../api/types";
import Modal from "../components/Modal";
import { useToast } from "../components/Toast";
import { Card, ConfirmButton, Empty, Field, Spinner } from "../components/ui";
import { parseNum, useInvalidateCatalog } from "./catalog";

interface TypeInput {
  nom: string;
  description: string | null;
  met_value: number | null;
  garmin_type_key: string | null;
}

function TypeForm({ initial, submitLabel, pending, onSubmit }: {
  initial?: ActivityType;
  submitLabel: string;
  pending?: boolean;
  onSubmit: (v: TypeInput) => void;
}) {
  const [nom, setNom] = useState(initial?.nom ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [met, setMet] = useState(initial?.met_value ? String(initial.met_value) : "");
  const [garminKey, setGarminKey] = useState(initial?.garmin_type_key ?? "");

  return (
    <form
      className="space-y-3"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        const m = parseNum(met);
        onSubmit({
          nom: nom.trim(),
          description: description.trim() || null,
          met_value: m && m > 0 ? m : null,
          garmin_type_key: garminKey.trim().toLowerCase() || null,
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <Field label="Nom"><input className="input" required placeholder="ex. Course à pied, Yoga…" value={nom} onChange={(e) => setNom(e.target.value)} /></Field>
        <Field label="Valeur MET" hint="course ≈ 8, yoga ≈ 3">
          <input className="input" type="number" min={0} step="any" value={met} onChange={(e) => setMet(e.target.value)} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <Field label="Description"><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Clé Garmin" hint="ex. running, cycling, yoga">
          <input className="input font-mono" value={garminKey} onChange={(e) => setGarminKey(e.target.value)} spellCheck={false} />
        </Field>
      </div>
      <div className="flex justify-end">
        <button type="submit" className="btn-primary" disabled={pending}>{submitLabel}</button>
      </div>
    </form>
  );
}

export default function ActivityTypesAdmin() {
  const types = useActivityTypes();
  const invalidate = useInvalidateCatalog();
  const toast = useToast();
  const [formKey, setFormKey] = useState(0);
  const [editing, setEditing] = useState<ActivityType | null>(null);

  const add = useMutation({
    mutationFn: (v: TypeInput) => api("/activity_types/", { method: "POST", body: v }),
    onSuccess: () => { invalidate(); toast("Type ajouté"); setFormKey((k) => k + 1); },
    onError: (e) => toast(e.message, "error"),
  });
  const save = useMutation({
    mutationFn: (v: TypeInput) => api(`/activity_types/${editing!.id}`, { method: "PUT", body: v }),
    onSuccess: () => { invalidate(); toast("Type enregistré"); setEditing(null); },
    onError: (e) => toast(e.message, "error"),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`/activity_types/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
    onError: (e) => toast(e.message, "error"),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Types proposés dans le formulaire d'activité. Les activités Garmin sont rattachées par leur clé Garmin ;
        un type inconnu est créé automatiquement à la synchronisation, avec un nom en français que tu peux modifier ici.
        Supprimer un type conserve les activités déjà enregistrées, sans type.
      </p>
      <Card title="Nouveau type d'activité">
        <TypeForm key={formKey} submitLabel="Ajouter" pending={add.isPending} onSubmit={(v) => add.mutate(v)} />
      </Card>
      <Card className="p-0 sm:p-0">
        {types.isLoading ? <div className="px-4"><Spinner /></div> : !types.list.length ? <div className="px-4"><Empty>Aucun type pour l'instant.</Empty></div> : (
          <ul className="divide-y divide-slate-100">
            {types.list.map((t) => (
              <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-900">
                    {t.nom}
                    {t.garmin_type_key && <span className="badge ml-2 bg-orange-50 font-mono text-orange-700">⌚ {t.garmin_type_key}</span>}
                  </div>
                  {t.description && <div className="truncate text-xs text-slate-500">{t.description}</div>}
                </div>
                <span className="w-16 text-right text-xs text-slate-500">{t.met_value ? `MET ${t.met_value}` : ""}</span>
                <button className="btn-ghost" aria-label={`Modifier ${t.nom}`} onClick={() => setEditing(t)}><Pencil className="h-4 w-4" /></button>
                <ConfirmButton compact label={`Supprimer ${t.nom}`} confirmLabel="Supprimer" disabled={remove.isPending} onConfirm={() => remove.mutate(t.id)} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && (
        <Modal title={`Modifier « ${editing.nom} »`} onClose={() => setEditing(null)}>
          <TypeForm initial={editing} submitLabel="Enregistrer" pending={save.isPending} onSubmit={(v) => save.mutate(v)} />
        </Modal>
      )}
    </div>
  );
}
