import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, Sparkles } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useToast } from "../components/Toast";
import { Card, Empty, ErrorMessage, Spinner } from "../components/ui";

interface AdminUser {
  id: number;
  nom: string;
  email: string;
  is_admin: boolean;
  coach_autorise: boolean;
  coach_access: boolean;
  garmin_connected: boolean;
  garmin_last_sync_at: string | null;
  bilans_coach: number;
  dernier_bilan_at: string | null;
  plan_genere_at: string | null;
  a_un_plan: boolean;
}

const fromUtc = (s: string) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
const dateFr = (s: string) => fromUtc(s).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });

/** Comptes : qui a accès au coach IA (chaque bilan coûte un appel à Claude). */
export default function UsersAdmin() {
  const { user: me, refreshUser } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const users = useQuery({ queryKey: ["admin_users"], queryFn: () => api<AdminUser[]>("/admin/users") });

  const update = (u: AdminUser) => {
    queryClient.setQueryData<AdminUser[]>(["admin_users"], (list) => list?.map((x) => (x.id === u.id ? u : x)));
    if (u.id === me?.id) refreshUser();
  };
  const setCoach = useMutation({
    mutationFn: ({ id, coach_autorise }: { id: number; coach_autorise: boolean }) =>
      api<AdminUser>(`/admin/users/${id}`, { method: "PUT", body: { coach_autorise } }),
    onSuccess: (u) => { update(u); toast(u.coach_autorise ? `Coach IA activé pour ${u.nom}` : `Coach IA retiré à ${u.nom}`); },
    onError: (e) => toast(e.message, "error"),
  });
  const allowPlan = useMutation({
    mutationFn: (id: number) => api<AdminUser>(`/admin/users/${id}`, { method: "PUT", body: { plan_regenerable: true } }),
    onSuccess: (u) => { update(u); toast(`${u.nom} peut générer un nouveau plan`); },
    onError: (e) => toast(e.message, "error"),
  });

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    const list = users.data ?? [];
    return s ? list.filter((u) => u.nom.toLowerCase().includes(s) || u.email.toLowerCase().includes(s)) : list;
  }, [users.data, search]);
  const allowed = (users.data ?? []).filter((u) => u.coach_access).length;

  if (users.isLoading) return <Spinner />;
  if (users.error) return <ErrorMessage error={users.error} />;

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        <Sparkles className="mr-1 inline h-4 w-4 text-violet-600" />
        Coach IA : {allowed} compte(s) sur {users.data?.length ?? 0}. Désactivé par défaut pour les nouveaux comptes,
        y compris les comptes admin : chacun s'active ici.
      </p>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input className="input pl-9" placeholder="Rechercher un nom ou un email…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {!rows.length ? (
        <Card><Empty>Aucun compte ne correspond.</Empty></Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {rows.map((u) => (
            <li key={u.id} className="card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-medium text-slate-900">
                    {u.nom}
                    {u.is_admin && <span className="badge ml-1.5 bg-slate-800 align-middle text-white">admin</span>}
                  </div>
                  <div className="truncate text-sm text-slate-500">{u.email}</div>
                  <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span>{u.garmin_connected ? "⌚ Garmin connecté" : "Pas de Garmin"}</span>
                    <span>
                      {u.bilans_coach ? `${u.bilans_coach} bilan(s) coach · dernier le ${dateFr(u.dernier_bilan_at!)}` : "Aucun bilan coach"}
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                    <span>
                      {u.plan_genere_at ? `Plan généré le ${dateFr(u.plan_genere_at)}`
                        : u.a_un_plan ? "Plan écrit à la main · génération possible" : "Pas de plan · génération possible"}
                    </span>
                    {u.plan_genere_at && (
                      <button type="button" className="font-medium text-violet-700 hover:underline disabled:opacity-50"
                        disabled={allowPlan.isPending} onClick={() => allowPlan.mutate(u.id)}>
                        Autoriser une nouvelle génération
                      </button>
                    )}
                  </div>
                </div>
                <label className="flex shrink-0 cursor-pointer flex-col items-end gap-1">
                  <span className="text-xs font-medium text-slate-600">Coach IA</span>
                  <span className="relative inline-flex">
                    <input
                      type="checkbox"
                      role="switch"
                      aria-label={`Coach IA pour ${u.nom}`}
                      className="peer sr-only"
                      checked={u.coach_access}
                      disabled={setCoach.isPending}
                      onChange={(e) => setCoach.mutate({ id: u.id, coach_autorise: e.target.checked })}
                    />
                    <span className="h-6 w-11 rounded-full bg-slate-300 transition peer-checked:bg-violet-600 peer-disabled:opacity-60 peer-focus-visible:ring-2 peer-focus-visible:ring-violet-200" />
                    <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
                  </span>
                </label>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
