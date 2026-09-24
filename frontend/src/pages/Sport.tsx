import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import listPlugin from "@fullcalendar/list";
import frLocale from "@fullcalendar/core/locales/fr";
import type { DatesSetArg, EventInput } from "@fullcalendar/core";
import { RefreshCw, Trash2, Unplug, Watch } from "lucide-react";
import { ApiError, api } from "../api/client";
import { useActivities, useActivityTypes, useIngredients, useMealLogs, useRecipes } from "../api/queries";
import type { GarminSyncResult } from "../api/types";
import { useAuth, useCurrentUser } from "../auth/AuthContext";
import { useToast } from "../components/Toast";
import { Card, Empty, Field, PageHeader } from "../components/ui";
import { addDays, formatFull, toISODate, todayISO } from "../lib/dates";
import { activityDetails, activityLabel } from "../lib/activity";
import { fmt, logMacros } from "../lib/nutrition";

export default function Sport() {
  return (
    <div className="space-y-4">
      <PageHeader title="Sport & activités" />
      <div className="grid gap-4 lg:grid-cols-2">
        <GarminCard />
        <ManualActivityForm />
      </div>
      <SportCalendar />
      <RecentActivities />
    </div>
  );
}

function useInvalidateSport() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["activities"] });
    queryClient.invalidateQueries({ queryKey: ["daily_stats"] });
  };
}

function GarminCard() {
  const user = useCurrentUser();
  const { refreshUser } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidateSport();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfa, setMfa] = useState("");
  const [needsMfa, setNeedsMfa] = useState(false);

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
          <GarminMoreOptions />
        </div>
      ) : (
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
      )}
    </Card>
  );
}

const HISTORY_OPTIONS = [30, 90, 180, 365];

function GarminMoreOptions() {
  const user = useCurrentUser();
  const { refreshUser } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidateSport();
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
    mutationFn: () => api<{ stats_days: number }>(`/users/${user.id}/garmin_recompute`, { method: "POST" }),
    onSuccess: (r) => { invalidate(); toast(`${r.stats_days} jour(s) recalculé(s) depuis les données brutes`); },
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

function ManualActivityForm() {
  const user = useCurrentUser();
  const types = useActivityTypes();
  const toast = useToast();
  const invalidate = useInvalidateSport();
  const empty = { date: todayISO(), type: "", duree: "30", calories: "", distance: "", fc: "", notes: "" };
  const [f, setF] = useState(empty);

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
      setF({ ...empty, date: f.date, type: f.type });
    },
    onError: (e) => toast(e.message, "error"),
  });

  const set = (key: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [key]: e.target.value });

  return (
    <Card title="Ajouter une activité">
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
        <button type="submit" className="btn-primary col-span-2" disabled={add.isPending}>Ajouter</button>
      </form>
    </Card>
  );
}

function SportCalendar() {
  const today = todayISO();
  const [range, setRange] = useState({ from: addDays(today, -40), to: addDays(today, 40) });
  const types = useActivityTypes();
  const ingredients = useIngredients();
  const recipes = useRecipes();
  const acts = useActivities({ date_from: range.from, date_to: range.to });
  const meals = useMealLogs({ date_from: range.from, date_to: range.to });

  const events = useMemo<EventInput[]>(() => {
    const out: EventInput[] = (acts.data ?? []).map((a) => {
      const details = activityDetails(a, { hr: false });
      return {
        id: `a${a.id}`,
        title: [activityLabel(a, types.byId), details].filter(Boolean).join(" · "),
        start: a.date,
        allDay: true,
        color: a.source === "garmin" ? "#ea580c" : "#2563eb",
      };
    });
    const byDate = new Map<string, { count: number; cal: number }>();
    for (const log of meals.data ?? []) {
      const d = byDate.get(log.date) ?? { count: 0, cal: 0 };
      d.count++;
      d.cal += logMacros(log, ingredients.byId, recipes.byId).cal;
      byDate.set(log.date, d);
    }
    for (const [date, d] of byDate) {
      out.push({ id: `m${date}`, title: `🍽 ${d.count} repas · ${fmt(d.cal)} kcal`, start: date, allDay: true, color: "#059669" });
    }
    return out;
  }, [acts.data, meals.data, types.byId, ingredients.byId, recipes.byId]);

  function onDatesSet(arg: DatesSetArg) {
    const from = toISODate(arg.start);
    const to = toISODate(addDaysDate(arg.end, -1));
    if (from !== range.from || to !== range.to) setRange({ from, to });
  }

  return (
    <Card title="Calendrier">
      <div className="mb-3 flex flex-wrap gap-3 text-xs text-slate-600">
        <Legend color="#059669" label="Repas" />
        <Legend color="#ea580c" label="Activité Garmin" />
        <Legend color="#2563eb" label="Activité manuelle" />
      </div>
      <FullCalendar
        plugins={[dayGridPlugin, listPlugin]}
        locale={frLocale}
        initialView={window.innerWidth < 640 ? "listWeek" : "dayGridMonth"}
        headerToolbar={{ left: "prev,next today", center: "title", right: "dayGridMonth,listWeek" }}
        events={events}
        datesSet={onDatesSet}
        height="auto"
        eventDisplay="block"
        dayMaxEvents={3}
      />
    </Card>
  );
}

function addDaysDate(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} /> {label}
    </span>
  );
}

function RecentActivities() {
  const today = todayISO();
  const acts = useActivities({ date_from: addDays(today, -60), date_to: today });
  const types = useActivityTypes();
  const toast = useToast();
  const invalidate = useInvalidateSport();

  const remove = useMutation({
    mutationFn: (id: number) => api(`/activities/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
    onError: (e) => toast(e.message, "error"),
  });

  const list = (acts.data ?? []).slice(0, 10);

  return (
    <Card title="Activités récentes">
      {!list.length ? <Empty>Aucune activité sur les 60 derniers jours.</Empty> : (
        <ul className="divide-y divide-slate-100">
          {list.map((a) => {
            const label = activityLabel(a, types.byId);
            return (
              <li key={a.id} className="flex items-center gap-3 py-2.5">
                <span className="w-24 shrink-0 text-sm text-slate-500">{formatFull(a.date)}</span>
                <span title={a.source === "garmin" ? "Garmin" : "Manuel"}>{a.source === "garmin" ? "⌚" : "✏️"}</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{label}</div>
                  <div className="truncate text-xs text-slate-500">
                    {activityDetails(a) || "—"}
                    {a.notes && a.notes !== label ? ` · ${a.notes}` : ""}
                  </div>
                </div>
                <button className="btn-ghost" aria-label="Supprimer" disabled={remove.isPending} onClick={() => remove.mutate(a.id)}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
