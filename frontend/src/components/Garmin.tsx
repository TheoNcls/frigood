import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Unplug, Watch } from "lucide-react";
import { ApiError, api } from "../api/client";
import { useActivities, useActivityTypes, useDailyStatsRange } from "../api/queries";
import type { GarminSyncResult, User } from "../api/types";
import { useAuth, useCurrentUser } from "../auth/AuthContext";
import { useToast } from "./Toast";
import { Card, Field } from "./ui";
import { addDays, formatShort, toISODate, todayISO } from "../lib/dates";
import { activityLabel } from "../lib/activity";
import { fmt } from "../lib/nutrition";

/** Tout ce qui concerne Garmin : carte de réglages du Profil. */

export function useInvalidateSport() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["activities"] });
    queryClient.invalidateQueries({ queryKey: ["daily_stats"] });
    queryClient.invalidateQueries({ queryKey: ["activity_types"] });
    queryClient.invalidateQueries({ queryKey: ["tasks"] });  // tâches sportives validées par une activité
  };
}

/** Date UTC de l'API (sans fuseau) → Date locale. */
function fromUtc(s: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
}

function whenLabel(d: Date): string {
  const day = toISODate(d);
  const today = todayISO();
  const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (day === today) return `aujourd'hui à ${time}`;
  if (day === addDays(today, -1)) return `hier à ${time}`;
  return `le ${formatShort(day)} à ${time}`;
}

function dayLabel(iso: string): string {
  const today = todayISO();
  if (iso === today) return "aujourd'hui";
  if (iso === addDays(today, -1)) return "hier";
  return `le ${formatShort(iso)}`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

function lastSyncSummary(user: User): { at: Date | null; result: string | null } {
  const at = user.garmin_last_sync_at ? fromUtc(user.garmin_last_sync_at) : null;
  const nActs = user.garmin_last_sync_activities;
  const nDays = user.garmin_last_sync_days;
  if (nActs === null && nDays === null) return { at, result: null };
  const parts = [];
  if (nActs) parts.push(plural(nActs, "nouvelle activité", "nouvelles activités"));
  if (nDays) parts.push(plural(nDays, "jour de données santé", "jours de données santé"));
  const result = parts.length ? parts.join(" · ") : "rien de nouveau";
  return { at, result: result.charAt(0).toUpperCase() + result.slice(1) };
}

const isAutoError = (user: User) => !!(user.garmin_auto_sync && user.garmin_auto_status && /Erreur|bloque|expirée/.test(user.garmin_auto_status));

/** Dernière mise à jour Garmin (bouton ou synchro du matin) et ce qu'elle a rapporté. */
function GarminLastSync() {
  const user = useCurrentUser();
  const today = todayISO();
  const acts = useActivities({ date_from: addDays(today, -60), date_to: today });
  const types = useActivityTypes();
  const stats = useDailyStatsRange(addDays(today, -7), today);

  const lastActivity = (acts.data ?? [])
    .filter((a) => a.source === "garmin")
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)[0];
  const lastNight = (stats.data ?? [])
    .filter((s) => s.sommeil_total_h)
    .sort((a, b) => b.date.localeCompare(a.date))[0];

  const { at, result } = lastSyncSummary(user);

  return (
    <div className="space-y-1.5 rounded-xl bg-slate-50 px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="font-medium text-slate-800">
          {at ? <>Dernière mise à jour {whenLabel(at)}</> : "Pas encore synchronisé"}
        </span>
        {at && user.garmin_last_sync_auto !== null && (
          <span className={`badge ${user.garmin_last_sync_auto ? "bg-violet-100 text-violet-700" : "bg-slate-200 text-slate-600"}`}>
            {user.garmin_last_sync_auto ? "automatique" : "manuelle"}
          </span>
        )}
      </div>
      {result && <div className="text-slate-600">{result}</div>}
      <ul className="space-y-0.5 text-xs text-slate-500">
        <li>
          Dernière activité :{" "}
          {lastActivity
            ? <span className="text-slate-700">{activityLabel(lastActivity, types.byId)} · {dayLabel(lastActivity.date)}</span>
            : "aucune sur 60 jours"}
        </li>
        <li>
          Dernière nuit :{" "}
          {lastNight
            ? <span className="text-slate-700">{lastNight.date === today ? "cette nuit" : `réveil ${dayLabel(lastNight.date)}`} · {fmt(lastNight.sommeil_total_h ?? 0, 1)} h{lastNight.sommeil_score !== null ? ` · ${lastNight.sommeil_score}/100` : ""}</span>
            : "aucune sur 7 jours"}
        </li>
      </ul>
      {isAutoError(user) && (
        <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">Synchro auto : {user.garmin_auto_status}</p>
      )}
    </div>
  );
}

export function GarminSettingsCard() {
  const user = useCurrentUser();
  const { refreshUser } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidateSport();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfa, setMfa] = useState("");
  const [needsMfa, setNeedsMfa] = useState(false);
  const [blocked, setBlocked] = useState(false);

  const sync = useMutation({
    mutationFn: (credentials: { email?: string; password?: string; mfa_code?: string }) =>
      api<GarminSyncResult>(`/users/${user.id}/garmin_sync`, { method: "POST", body: credentials }),
    onSuccess: async (res) => {
      setNeedsMfa(false);
      setPassword("");
      setMfa("");
      toast(
        `${res.imported} activité(s) importée(s), ${res.stats_days} jour(s) de données santé synchronisé(s)` +
        (res.remaining_days > 0 ? ` — ${res.remaining_days} jour(s) restant(s) : utilise « Récupérer l'historique »` : ""),
      );
      invalidate();
      await refreshUser();
    },
    onError: async (e) => {
      if (e instanceof ApiError && e.message === "CODE_MFA_REQUIS") {
        setNeedsMfa(true);
        return;
      }
      if (e instanceof ApiError && e.message === "SESSION_GARMIN_EXPIREE") {
        toast("Session Garmin expirée, reconnecte-toi", "error");
        await refreshUser();
        return;
      }
      if (e instanceof ApiError && e.message === "GARMIN_BLOQUE") {
        setNeedsMfa(false);
        setBlocked(true);
        return;
      }
      toast(e.message, "error");
    },
  });

  const disconnect = useMutation({
    mutationFn: () => api(`/users/${user.id}/garmin_disconnect`, { method: "DELETE" }),
    onSuccess: () => refreshUser(),
    onError: (e) => toast(e.message, "error"),
  });

  return (
    <Card title={<span className="inline-flex items-center gap-1.5"><Watch className="h-4 w-4" /> Garmin Connect</span>}>
      {user.garmin_connected ? (
        <div className="space-y-3">
          <p className="text-sm text-emerald-700">✅ Connecté à Garmin Connect</p>
          <GarminLastSync />
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={sync.isPending} onClick={() => sync.mutate({})}>
              <RefreshCw className={`h-4 w-4 ${sync.isPending ? "animate-spin" : ""}`} />
              {sync.isPending ? "Synchronisation…" : "Synchroniser"}
            </button>
            <button className="btn-secondary" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>
              <Unplug className="h-4 w-4" /> Déconnecter
            </button>
          </div>
          <p className="text-xs text-slate-500">
            Importe les 50 dernières activités et complète les données santé depuis la dernière synchronisation (30 jours max).
          </p>
          <div className="border-t border-slate-100 pt-3">
            <GarminAutoSetting />
          </div>
          <GarminMoreOptions />
        </div>
      ) : (
        <div className="space-y-3">
        {blocked && (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
            Garmin bloque les connexions par mot de passe venant du serveur de Frigood. Réessayer maintenant prolongerait le blocage :
            connecte-toi plutôt depuis ton PC et importe la session ci-dessous.
          </p>
        )}
        <form
          className="space-y-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            sync.mutate({ email, password, mfa_code: needsMfa ? mfa : undefined });
          }}
        >
          {needsMfa && (
            <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Garmin demande un code de vérification : regarde tes emails ou ton application d'authentification.
            </p>
          )}
          <Field label="Email Garmin Connect">
            <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Mot de passe">
            <input className="input" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
          </Field>
          {needsMfa && (
            <Field label="Code MFA">
              <input className="input" inputMode="numeric" required value={mfa} onChange={(e) => setMfa(e.target.value)} autoFocus />
            </Field>
          )}
          <button type="submit" className="btn-primary w-full" disabled={sync.isPending}>
            {sync.isPending ? "Connexion…" : "Se connecter et synchroniser"}
          </button>
          <p className="text-xs text-slate-500">Ton mot de passe Garmin n'est pas enregistré : seule la session l'est.</p>
        </form>
        <GarminImportSession open={blocked} onImported={() => setBlocked(false)} />
        </div>
      )}
    </Card>
  );
}

function GarminImportSession({ open, onImported }: { open: boolean; onImported: () => void }) {
  const user = useCurrentUser();
  const { refreshUser } = useAuth();
  const toast = useToast();
  const [tokens, setTokens] = useState("");

  const save = useMutation({
    mutationFn: () => api(`/users/${user.id}/garmin_tokens`, { method: "POST", body: { tokens: tokens.trim() } }),
    onSuccess: async () => {
      setTokens("");
      toast("Session Garmin importée : tu peux synchroniser");
      onImported();
      await refreshUser();
    },
    onError: (e) => toast(e.message, "error"),
  });

  return (
    <details open={open || undefined} className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium text-slate-600">Connexion bloquée ? Importer une session depuis ton PC</summary>
      <div className="mt-3 space-y-3">
        <ol className="list-decimal space-y-1 pl-5 text-xs text-slate-600">
          <li>Sur ton PC, dans le dossier du projet :
            <code className="mt-1 block overflow-x-auto whitespace-pre rounded-lg bg-slate-100 px-2 py-1.5 text-[11px] text-slate-800">
              {"venv\\Scripts\\python.exe -m pip install garminconnect==0.3.16\nvenv\\Scripts\\python.exe scripts\\garmin_login.py"}
            </code>
          </li>
          <li>Saisis ton email, ton mot de passe Garmin et le code reçu par mail.</li>
          <li>Copie le texte affiché (il commence par <code>{"{"}</code>) et colle-le ici.</li>
        </ol>
        <textarea
          className="input min-h-[5rem] font-mono text-xs"
          placeholder='{"di_token": "…", "di_refresh_token": "…", "di_client_id": "…"}'
          value={tokens}
          onChange={(e) => setTokens(e.target.value)}
          spellCheck={false}
        />
        <button className="btn-primary" disabled={save.isPending || !tokens.trim()} onClick={() => save.mutate()}>
          {save.isPending ? "Import…" : "Importer la session"}
        </button>
        <p className="text-xs text-slate-500">Ce texte donne accès à ton compte Garmin : ne le partage avec personne d'autre.</p>
      </div>
    </details>
  );
}

const HISTORY_OPTIONS = [30, 90, 180, 365];

function GarminMoreOptions() {
  const user = useCurrentUser();
  const { refreshUser } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidateSport();
  const queryClient = useQueryClient();
  const [days, setDays] = useState(90);
  const [progress, setProgress] = useState<{ done: number; remaining: number | null } | null>(null);

  const history = useMutation({
    mutationFn: async (n: number) => {
      // Le serveur traite 30 jours par appel : on relance tant qu'il en reste et que ça avance
      let done = 0;
      let imported = 0;
      let previous = Infinity;
      setProgress({ done: 0, remaining: null });
      for (let i = 0; i < 20; i++) {
        const res = await api<GarminSyncResult>(`/users/${user.id}/garmin_sync`, {
          method: "POST", body: {}, query: { history_days: n },
        });
        done += res.stats_days;
        imported += res.imported;
        setProgress({ done, remaining: res.remaining_days });
        if (res.remaining_days === 0 || res.stats_days === 0 || res.remaining_days >= previous) {
          return { done, imported, remaining: res.remaining_days };
        }
        previous = res.remaining_days;
      }
      return { done, imported, remaining: previous };
    },
    onSuccess: (r) => {
      invalidate();
      toast(
        `${r.done} jour(s) récupéré(s), ${r.imported} activité(s) importée(s)` +
        (r.remaining > 0 ? ` — ${r.remaining} jour(s) n'ont pas pu être récupérés, réessaie plus tard` : ""),
      );
    },
    onError: async (e) => {
      invalidate();
      if (e instanceof ApiError && e.message === "SESSION_GARMIN_EXPIREE") {
        toast("Session Garmin expirée, reconnecte-toi", "error");
        await refreshUser();
        return;
      }
      toast(e.message, "error");
    },
    onSettled: () => setProgress(null),
  });

  const recompute = useMutation({
    mutationFn: () => api<{ stats_days: number; activities_typed: number }>(`/users/${user.id}/garmin_recompute`, { method: "POST" }),
    onSuccess: (r) => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["activity_types"] });
      toast(
        `${r.stats_days} jour(s) recalculé(s) depuis les données brutes` +
        (r.activities_typed ? `, ${r.activities_typed} activité(s) rattachée(s) à un type` : ""),
      );
    },
    onError: (e) => toast(e.message, "error"),
  });

  return (
    <details className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
      <summary className="cursor-pointer font-medium text-slate-600">Plus d'options</summary>
      <div className="mt-3 space-y-4">
        <div className="space-y-2">
          <div className="font-medium text-slate-700">Récupérer l'historique</div>
          <p className="text-xs text-slate-500">Comble les jours manquants ou incomplets sur la période. Compte environ une minute par mois.</p>
          <div className="flex flex-wrap items-center gap-2">
            <select className="input w-auto" value={days} disabled={history.isPending} onChange={(e) => setDays(Number(e.target.value))}>
              {HISTORY_OPTIONS.map((d) => <option key={d} value={d}>{d === 365 ? "1 an" : `${d} jours`}</option>)}
            </select>
            <button className="btn-secondary" disabled={history.isPending} onClick={() => history.mutate(days)}>
              {history.isPending ? "Récupération…" : "Récupérer"}
            </button>
          </div>
          {progress && (
            <p className="text-xs text-slate-600">
              {progress.done} jour(s) récupéré(s){progress.remaining !== null ? `, ${progress.remaining} restant(s)` : ""}…
            </p>
          )}
        </div>
        <div className="space-y-2">
          <div className="font-medium text-slate-700">Recalculer les données santé</div>
          <p className="text-xs text-slate-500">Relit les réponses Garmin déjà enregistrées, sans rien redemander à Garmin.</p>
          <button className="btn-secondary" disabled={recompute.isPending} onClick={() => recompute.mutate()}>
            {recompute.isPending ? "Recalcul…" : "Recalculer"}
          </button>
        </div>
      </div>
    </details>
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
          disabled={save.isPending}
          onChange={(enabled) => save.mutate({ enabled, heure })}
        />
      </div>
      {on ? (
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
