import { useEffect, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { Bell, BellOff, LogOut, Send } from "lucide-react";
import { currentSubscription, disablePush, enablePush, isIOS, isStandalone, pushSupported } from "../lib/push";
import { api } from "../api/client";
import type { RegimeAlimentaire, User } from "../api/types";
import { useAuth, useCurrentUser } from "../auth/AuthContext";
import { useToast } from "../components/Toast";
import { usePreferences } from "../lib/preferences";
import { fmt } from "../lib/nutrition";
import { todayISO } from "../lib/dates";
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
      <CoachingProfileCard />
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
  const [naissance, setNaissance] = useState(user.date_naissance ?? "");
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
        date_naissance: naissance || null,
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
        <Field label="Date de naissance" hint={naissance ? `${ageFrom(naissance)} ans` : "Facultatif : servira aux calculs adaptés à l'âge."}>
          <input className="input max-w-[12rem]" type="date" min="1900-01-01" max={todayISO()} value={naissance} onChange={(e) => setNaissance(e.target.value)} />
        </Field>
        {user.nutrition_active && <div>
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
        </div>}
        <button type="submit" className="btn-primary" disabled={save.isPending}>Enregistrer</button>
      </form>
    </Card>
  );
}

function ageFrom(iso: string): number {
  const birth = new Date(`${iso}T12:00`);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) age--;
  return age;
}

const COACHING_MAX = 4000;

/** Texte libre enregistré sur le compte : infos et objectifs, pour un futur coaching personnalisé. */
function CoachingProfileCard() {
  const user = useCurrentUser();
  const { setUser } = useAuth();
  const toast = useToast();
  const [text, setText] = useState(user.profil_coaching ?? "");
  const changed = text.trim() !== (user.profil_coaching ?? "");

  const save = useMutation({
    mutationFn: () => api<User>(`/users/${user.id}`, { method: "PUT", body: { profil_coaching: text.trim() || null } }),
    onSuccess: (u) => { setUser(u); setText(u.profil_coaching ?? ""); toast("Infos & objectifs enregistrés"); },
    onError: (e) => toast(e.message, "error"),
  });

  return (
    <Card title="Mes infos & objectifs">
      <p className="mb-2 text-sm text-slate-600">
        Écris librement ce qui compte pour toi : objectifs, contexte, contraintes. Ce texte servira plus tard à des conseils
        et un coaching personnalisés.
      </p>
      <textarea
        className="input min-h-[10rem]"
        maxLength={COACHING_MAX}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"ex. Je prépare un semi-marathon en mars, 3 sorties par semaine.\nObjectif : perdre 2 kg en gardant ma masse musculaire.\nVégétarien, pas de champignons, peu de temps le midi.\nBlessure au genou droit l'an dernier."}
      />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-slate-500">{text.length} / {COACHING_MAX}</span>
        <button type="button" className="btn-primary" disabled={save.isPending || !changed} onClick={() => save.mutate()}>
          Enregistrer
        </button>
      </div>
    </Card>
  );
}

function PreferencesCard() {
  const user = useCurrentUser();
  const { showPhotos, setPreference } = usePreferences();
  return (
    <Card title="Préférences">
      <NutritionSetting />
      <div className="my-4 border-t border-slate-100" />
      {user.nutrition_active && (
        <>
          <RegimeSetting />
          <div className="my-4 border-t border-slate-100" />
        </>
      )}
      <MaterielSetting />
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
      <div className="my-4 border-t border-slate-100" />
      <NotificationsSetting />
    </Card>
  );
}

/** Partie Nutrition : affichée ou masquée (réglage du compte ; rien n'est supprimé). */
function NutritionSetting() {
  const user = useCurrentUser();
  const { setUser } = useAuth();
  const toast = useToast();
  const save = useMutation({
    mutationFn: (nutrition_active: boolean) => api<User>(`/users/${user.id}`, { method: "PUT", body: { nutrition_active } }),
    onSuccess: (u) => { setUser(u); toast(u.nutrition_active ? "Partie Nutrition affichée" : "Partie Nutrition masquée"); },
    onError: (e) => toast(e.message, "error"),
  });
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4">
      <span>
        <span className="block text-sm font-medium text-slate-800">Nutrition</span>
        <span className="block text-xs text-slate-500">
          {user.nutrition_active
            ? "Repas, calories et objectifs nutritionnels. Désactive si tu ne suis pas ton alimentation : c'est seulement masqué, rien n'est supprimé."
            : "Masquée : pas d'onglet Repas, ni de calories ou d'objectifs nutritionnels. Tes repas déjà notés sont conservés."}
          {" "}Réglage de ton compte.
        </span>
      </span>
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input
          type="checkbox"
          role="switch"
          aria-label="Afficher la partie Nutrition"
          className="peer sr-only"
          checked={user.nutrition_active}
          disabled={save.isPending}
          onChange={(e) => save.mutate(e.target.checked)}
        />
        <span className="h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-brand-600 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-100" />
        <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

const REGIME_OPTIONS: { value: RegimeAlimentaire; label: string }[] = [
  { value: "omnivore", label: "Omnivore" },
  { value: "flexitarien", label: "Flexitarien" },
  { value: "pescetarien", label: "Pescétarien" },
  { value: "vegetarien", label: "Végétarien" },
  { value: "vegan", label: "Végan" },
];

/** Régime alimentaire : réglage du compte, transmis au coach. */
function RegimeSetting() {
  const user = useCurrentUser();
  const { setUser } = useAuth();
  const toast = useToast();
  const save = useMutation({
    mutationFn: (regime_alimentaire: RegimeAlimentaire) => api<User>(`/users/${user.id}`, { method: "PUT", body: { regime_alimentaire } }),
    onSuccess: (u) => { setUser(u); toast("Régime alimentaire enregistré"); },
    onError: (e) => toast(e.message, "error"),
  });
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <span>
        <span className="block text-sm font-medium text-slate-800">Régime alimentaire</span>
        <span className="block text-xs text-slate-500">Le coach en tient compte pour ses conseils et ses recettes. Réglage de ton compte.</span>
      </span>
      <select
        className="input w-auto"
        aria-label="Régime alimentaire"
        value={user.regime_alimentaire}
        disabled={save.isPending}
        onChange={(e) => save.mutate(e.target.value as RegimeAlimentaire)}
      >
        {REGIME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

// Mêmes clés que garmin_workouts.EQUIPMENT côté serveur
const MATERIEL_OPTIONS: { value: string; label: string }[] = [
  { value: "halteres", label: "Haltères" },
  { value: "kettlebell", label: "Kettlebell" },
  { value: "elastiques", label: "Élastiques" },
  { value: "barre", label: "Barre et disques" },
  { value: "banc", label: "Banc de musculation" },
  { value: "barre_traction", label: "Barre de traction" },
  { value: "machines", label: "Machines et poulies (salle)" },
  { value: "trx", label: "TRX / sangles" },
  { value: "swiss_ball", label: "Swiss ball" },
  { value: "medecine_ball", label: "Médecine-ball" },
];

/** Matériel de renfo : le coach ne propose que des exercices faisables avec. */
function MaterielSetting() {
  const user = useCurrentUser();
  const { setUser } = useAuth();
  const toast = useToast();
  const [picked, setPicked] = useState<string[]>(user.materiel ?? []);
  const changed = user.materiel === null || [...picked].sort().join() !== [...user.materiel].sort().join();
  const all = picked.length === MATERIEL_OPTIONS.length;

  const save = useMutation({
    mutationFn: () => api<User>(`/users/${user.id}`, { method: "PUT", body: { materiel: picked } }),
    onSuccess: (u) => { setUser(u); setPicked(u.materiel ?? []); toast("Matériel enregistré"); },
    onError: (e) => toast(e.message, "error"),
  });
  const toggle = (v: string) => setPicked((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]));

  return (
    <div>
      <span className="block text-sm font-medium text-slate-800">Matériel de renforcement</span>
      <span className="block text-xs text-slate-500">
        Le coach choisit ses exercices (poids du corps, mobilité, et ceux de ton matériel) parmi ceux que ta montre Garmin connaît.
        {user.materiel === null && " Pas encore renseigné : il peut tout proposer."}
      </span>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className="rounded-full border border-brand-100 bg-brand-50 px-3 py-1 text-xs text-brand-700">Poids du corps ✓</span>
        {MATERIEL_OPTIONS.map((o) => {
          const on = picked.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              className={`rounded-full border px-3 py-1 text-xs transition ${on ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}
              onClick={() => toggle(o.value)}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="text-xs font-medium text-brand-700 hover:underline"
          onClick={() => setPicked(all ? [] : MATERIEL_OPTIONS.map((o) => o.value))}>
          {all ? "Tout décocher" : "Salle de sport : tout cocher"}
        </button>
        <button type="button" className="btn-primary" disabled={save.isPending || !changed} onClick={() => save.mutate()}>
          Enregistrer
        </button>
      </div>
    </div>
  );
}

/** Notifications de cet appareil (rappels des tâches importantes). */
function NotificationsSetting() {
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
    <div>
      <span className="block text-sm font-medium text-slate-800">Notifications</span>
      <p className="mb-2 text-xs text-slate-500">
        Rappels des tâches importantes : 3 jours avant, la veille (9 h) et le jour même (8 h, ou 1 h avant l'heure prévue).
        Réglage propre à cet appareil.
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
    </div>
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
