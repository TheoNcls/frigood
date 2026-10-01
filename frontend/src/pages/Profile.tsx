import { useEffect, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { Bell, BellOff, LogOut, Send } from "lucide-react";
import { currentSubscription, disablePush, enablePush, isIOS, isStandalone, pushSupported } from "../lib/push";
import { api } from "../api/client";
import type { User } from "../api/types";
import { useAuth, useCurrentUser } from "../auth/AuthContext";
import { useToast } from "../components/Toast";
import { usePreferences } from "../lib/preferences";
import { fmt } from "../lib/nutrition";
import { GarminSettingsCard } from "../components/Garmin";
import { WeighInsCard, useLatestWeight } from "../components/Body";
import { Card, Field, PageHeader } from "../components/ui";

function numOrNull(v: string): number | null {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export default function Profile() {
  // Lien vers /profil#garmin : défiler jusqu'à la carte Garmin
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [hash]);

  return (
    <div className="max-w-2xl space-y-4">
      <PageHeader title="Profil" />
      <ProfileForm />
      <div id="garmin" className="scroll-mt-4"><GarminSettingsCard /></div>
      <WeighInsCard />
      <PreferencesCard />
      <NotificationsCard />
      <PasswordForm />
      <LogoutCard />
    </div>
  );
}

/** Déconnexion : sur téléphone, le menu du bas n'a pas de bouton pour ça. */
function LogoutCard() {
  const user = useCurrentUser();
  const { logout } = useAuth();
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-slate-600">
          Connecté en tant que <span className="font-medium text-slate-800">{user.email}</span>
        </div>
        <button type="button" className="btn-secondary text-red-600" onClick={logout}>
          <LogOut className="h-4 w-4" /> Se déconnecter
        </button>
      </div>
    </Card>
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
  // Protéines : en grammes fixes, ou en g/kg de poids (suit alors la dernière pesée)
  const poids = useLatestWeight();
  const [parKg, setParKg] = useState(user.proteines_g_kg !== null);
  const [gKg, setGKg] = useState(String(user.proteines_g_kg ?? "1.4"));
  const gKgNum = parseFloat(gKg.replace(",", "."));
  const protFromKg = poids && gKgNum > 0 ? Math.round(gKgNum * poids) : null;

  const save = useMutation({
    mutationFn: () => api<User>(`/users/${user.id}`, {
      method: "PUT",
      body: {
        nom: nom.trim(),
        calories_cible: numOrNull(t.cal),
        proteines_cible: parKg ? (protFromKg ?? numOrNull(t.prot)) : numOrNull(t.prot),
        glucides_cible: numOrNull(t.gluc),
        lipides_cible: numOrNull(t.lip),
        proteines_g_kg: parKg && gKgNum > 0 ? gKgNum : null,
      },
    }),
    onSuccess: (u) => { setUser(u); setT((x) => ({ ...x, prot: String(u.proteines_cible ?? "") })); toast("Profil mis à jour !"); },
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
              <Field key={key} label={label} hint={key === "prot" && parKg ? (protFromKg ? `= ${gKg} g/kg × ${fmt(poids!, 1)} kg` : "Ajoute une pesée pour le calcul") : undefined}>
                <input
                  className="input"
                  type="number"
                  min={0}
                  step="any"
                  value={key === "prot" && parKg && protFromKg ? String(protFromKg) : t[key]}
                  disabled={key === "prot" && parKg && !!protFromKg}
                  onChange={(e) => setT({ ...t, [key]: e.target.value })}
                />
              </Field>
            ))}
          </div>
          <label className="mt-3 flex cursor-pointer flex-wrap items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={parKg} onChange={(e) => setParKg(e.target.checked)} />
            Protéines selon mon poids
            {parKg && (
              <span className="inline-flex items-center gap-1.5">
                :
                <input className="input w-20 py-1" inputMode="decimal" value={gKg} onChange={(e) => setGKg(e.target.value)} aria-label="Grammes de protéines par kg" />
                g/kg
              </span>
            )}
          </label>
          {parKg && (
            <p className="mt-1 text-xs text-slate-500">
              Repère : 1,2 à 1,6 g/kg pour un sportif végétarien. L'objectif suit automatiquement ta dernière pesée.
            </p>
          )}
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
