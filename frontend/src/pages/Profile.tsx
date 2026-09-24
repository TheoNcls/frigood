import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../api/client";
import type { User } from "../api/types";
import { useAuth, useCurrentUser } from "../auth/AuthContext";
import { useToast } from "../components/Toast";
import { usePreferences } from "../lib/preferences";
import { Card, Field, PageHeader } from "../components/ui";

function numOrNull(v: string): number | null {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export default function Profile() {
  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title="Profil" />
      <ProfileForm />
      <PreferencesCard />
      <PasswordForm />
    </div>
  );
}

function ProfileForm() {
  const user = useCurrentUser();
  const { setUser } = useAuth();
  const toast = useToast();
  const [nom, setNom] = useState(user.nom);
  const [t, setT] = useState({
    cal: String(user.calories_cible ?? ""),
    prot: String(user.proteines_cible ?? ""),
    gluc: String(user.glucides_cible ?? ""),
    lip: String(user.lipides_cible ?? ""),
  });

  const save = useMutation({
    mutationFn: () => api<User>(`/users/${user.id}`, {
      method: "PUT",
      body: {
        nom: nom.trim(),
        calories_cible: numOrNull(t.cal),
        proteines_cible: numOrNull(t.prot),
        glucides_cible: numOrNull(t.gluc),
        lipides_cible: numOrNull(t.lip),
      },
    }),
    onSuccess: (u) => { setUser(u); toast("Profil mis à jour !"); },
    onError: (e) => toast(e.message, "error"),
  });

  return (
    <Card title="Informations & objectifs">
      <form className="space-y-4" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }}>
        <Field label="Nom">
          <input className="input" required value={nom} onChange={(e) => setNom(e.target.value)} />
        </Field>
        <p className="text-sm text-slate-500">Email : {user.email}</p>
        <div>
          <div className="label">Objectifs nutritionnels (par jour)</div>
          <div className="grid grid-cols-2 gap-3">
            {([["cal", "Calories (kcal)"], ["prot", "Protéines (g)"], ["gluc", "Glucides (g)"], ["lip", "Lipides (g)"]] as const).map(([key, label]) => (
              <Field key={key} label={label}>
                <input className="input" type="number" min={0} step="any" value={t[key]} onChange={(e) => setT({ ...t, [key]: e.target.value })} />
              </Field>
            ))}
          </div>
        </div>
        <button type="submit" className="btn-primary" disabled={save.isPending}>Enregistrer</button>
      </form>
    </Card>
  );
}

function PreferencesCard() {
  const { showPhotos, setPreference } = usePreferences();
  return (
    <Card title="Préférences">
      <label className="flex cursor-pointer items-start justify-between gap-4">
        <span>
          <span className="block text-sm font-medium text-slate-800">Photos des produits</span>
          <span className="block text-xs text-slate-500">
            {showPhotos
              ? "Photo du produit quand elle existe, sinon l'emoji de sa catégorie."
              : "Emoji de la catégorie uniquement : aucune image n'est téléchargée."}
            {" "}Réglage propre à cet appareil.
          </span>
        </span>
        <span className="relative mt-0.5 inline-flex shrink-0">
          <input
            type="checkbox"
            role="switch"
            className="peer sr-only"
            checked={showPhotos}
            onChange={(e) => setPreference("showPhotos", e.target.checked)}
          />
          <span className="h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-brand-600 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-100" />
          <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
        </span>
      </label>
    </Card>
  );
}

function PasswordForm() {
  const user = useCurrentUser();
  const toast = useToast();
  const [f, setF] = useState({ old: "", next: "", confirm: "" });

  const change = useMutation({
    mutationFn: () => api(`/users/${user.id}/change_password`, {
      method: "POST",
      body: { old_password: f.old, new_password: f.next },
    }),
    onSuccess: () => { toast("Mot de passe changé !"); setF({ old: "", next: "", confirm: "" }); },
    onError: (e) => toast(e.message, "error"),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (f.next !== f.confirm) return toast("Les mots de passe ne correspondent pas", "error");
    change.mutate();
  }

  return (
    <Card title="Changer de mot de passe">
      <form className="space-y-3" onSubmit={submit}>
        <Field label="Mot de passe actuel">
          <input className="input" type="password" required autoComplete="current-password" value={f.old} onChange={(e) => setF({ ...f, old: e.target.value })} />
        </Field>
        <Field label="Nouveau mot de passe" hint="8 caractères minimum">
          <input className="input" type="password" required minLength={8} autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />
        </Field>
        <Field label="Confirmer le nouveau mot de passe">
          <input className="input" type="password" required autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
        </Field>
        <button type="submit" className="btn-secondary" disabled={change.isPending}>Changer</button>
      </form>
    </Card>
  );
}
