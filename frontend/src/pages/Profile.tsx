import { useEffect, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Bell, BellOff, Send, Watch } from "lucide-react";
import { currentSubscription, disablePush, enablePush, isIOS, isStandalone, pushSupported } from "../lib/push";
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
      <NotificationsCard />
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
      <GarminAutoSetting />
      <div className="my-4 border-t border-slate-100" />
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

function Switch({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  // <label> : un appui sur l'interrupteur visible bascule la case cachée
  return (
    <label className="relative mt-0.5 inline-flex shrink-0 cursor-pointer">
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-brand-600 peer-disabled:opacity-50 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-100" />
      <span className="pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
    </label>
  );
}

/** Synchro Garmin du matin : réglage du compte (vaut pour tous les appareils). */
function GarminAutoSetting() {
  const user = useCurrentUser();
  const { setUser } = useAuth();
  const toast = useToast();
  const [heure, setHeure] = useState(user.garmin_auto_heure || "07:00");

  const save = useMutation({
    mutationFn: (body: { enabled: boolean; heure: string }) => api<User>(`/users/${user.id}/garmin_auto`, { method: "PUT", body }),
    onSuccess: (u) => {
      setUser(u);
      toast(u.garmin_auto_sync ? `Synchro automatique chaque jour vers ${u.garmin_auto_heure}` : "Synchro automatique désactivée");
    },
    onError: (e) => toast(e.message, "error"),
  });

  const on = user.garmin_auto_sync;
  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <span>
          <span className="flex items-center gap-1.5 text-sm font-medium text-slate-800"><Watch className="h-4 w-4" /> Synchro Garmin automatique</span>
          <span className="block text-xs text-slate-500">
            Chaque matin, le serveur récupère tes nuits, tes pas et tes activités, sans que tu ouvres l'app. Réglage de ton compte.
          </span>
        </span>
        <Switch
          label="Synchro Garmin automatique"
          checked={on}
          disabled={save.isPending || (!user.garmin_connected && !on)}
          onChange={(enabled) => save.mutate({ enabled, heure })}
        />
      </div>
      {!user.garmin_connected ? (
        <p className="mt-2 text-xs text-amber-700">
          Connecte d'abord ton compte Garmin depuis la page <Link to="/sport" className="font-medium underline">Sport</Link>.
        </p>
      ) : on ? (
        <div className="mt-3 space-y-2">
          <label className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
            Vers
            <input
              type="time"
              className="input w-32"
              value={heure}
              onChange={(e) => setHeure(e.target.value)}
            />
            {heure && heure !== user.garmin_auto_heure ? (
              <button type="button" className="btn-primary py-1.5" disabled={save.isPending} onClick={() => save.mutate({ enabled: true, heure })}>
                Enregistrer
              </button>
            ) : (
              <span className="text-xs text-slate-500">(à quelques minutes près)</span>
            )}
          </label>
          <p className="text-xs text-slate-500">
            Conseil : une heure après ton réveil habituel, le temps que la montre envoie la nuit à Garmin.
          </p>
          {user.garmin_auto_status && (
            <p className={`rounded-lg px-2.5 py-1.5 text-xs ${/Erreur|bloque|expirée/.test(user.garmin_auto_status) ? "bg-amber-50 text-amber-800" : "bg-slate-50 text-slate-600"}`}>
              Dernier passage : {user.garmin_auto_status}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function NotificationsCard() {
  const user = useCurrentUser();
  const toast = useToast();
  const [active, setActive] = useState<boolean | null>(null);
  const supported = pushSupported();
  const needsHomeScreen = isIOS() && !isStandalone();

  useEffect(() => {
    currentSubscription().then((s) => setActive(!!s)).catch(() => setActive(false));
  }, []);

  const toggle = useMutation({
    mutationFn: async (on: boolean) => {
      if (on) await enablePush(user.id);
      else await disablePush(user.id);
      return on;
    },
    onSuccess: (on) => {
      setActive(on);
      toast(on ? "Notifications activées sur cet appareil" : "Notifications désactivées sur cet appareil");
    },
    onError: (e) => toast(e.message, "error"),
  });

  const test = useMutation({
    mutationFn: () => api(`/users/${user.id}/push/test`, { method: "POST" }),
    onSuccess: () => toast("Notification de test envoyée"),
    onError: (e) => toast(e.message, "error"),
  });

  return (
    <Card title="Notifications">
      <p className="mb-3 text-sm text-slate-600">
        Rappels des tâches <span className="font-medium">importantes</span> : 3 jours avant, la veille (9 h) et le jour même
        (8 h, ou 1 h avant l'heure prévue). Réglage propre à cet appareil.
      </p>
      {needsHomeScreen ? (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Sur iPhone, ouvre Frigood depuis l'icône de l'écran d'accueil (Partager → « Sur l'écran d'accueil ») pour activer les notifications.
        </p>
      ) : !supported ? (
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">Ce navigateur ne gère pas les notifications.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {active ? (
            <>
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700"><Bell className="h-4 w-4" /> Activées</span>
              <button type="button" className="btn-secondary" disabled={test.isPending} onClick={() => test.mutate()}>
                <Send className="h-4 w-4" /> Envoyer un test
              </button>
              <button type="button" className="btn-ghost" disabled={toggle.isPending} onClick={() => toggle.mutate(false)}>
                <BellOff className="h-4 w-4" /> Désactiver
              </button>
            </>
          ) : (
            <button type="button" className="btn-primary" disabled={toggle.isPending || active === null} onClick={() => toggle.mutate(true)}>
              <Bell className="h-4 w-4" /> Activer sur cet appareil
            </button>
          )}
        </div>
      )}
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
