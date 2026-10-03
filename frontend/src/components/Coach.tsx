import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { CalendarPlus, Check, ChefHat, HeartPulse, Lightbulb, Search, Sparkles } from "lucide-react";
import { api } from "../api/client";
import { useCurrentUser } from "../auth/AuthContext";
import type { SeanceStep } from "../api/types";
import { SeanceSteps } from "./Seance";
import { formatLong, todayISO } from "../lib/dates";
import { useToast } from "./Toast";
import { Card, Segmented, Spinner } from "./ui";

interface CoachRecipe {
  titre: string;
  pourquoi: string;
  ingredients: string[];
  etapes: string[];
}

interface CoachActivity {
  date: string;
  sport: string;
  titre: string;
  duree_min: number | null;
  details: string;
  etapes?: SeanceStep[];
}

interface CoachResult {
  remarques: string;
  sante_recuperation: string;
  ameliorations: string;
  recettes: CoachRecipe[];
  activites: CoachActivity[];
}

interface CoachReport {
  id: number;
  created_at: string;
  texte: string;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  /** Bilan structuré (les anciens bilans n'ont que le texte) */
  donnees: CoachResult | null;
  activites_ajoutees_at: string | null;
  /** Lundi de la semaine préparée */
  semaine_cible: string | null;
}

/** Gras **…** dans une ligne. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? <strong key={i} className="font-semibold text-slate-900">{part.slice(2, -2)}</strong> : part,
  );
}

/** Markdown simple renvoyé par le coach : titres ##/###, listes -, * ou 1., paragraphes, gras. */
function CoachText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push(<p key={blocks.length} className="text-sm leading-relaxed text-slate-700">{inline(para.join(" "))}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>);
    blocks.push(list.ordered
      ? <ol key={blocks.length} className="list-decimal space-y-1 pl-5 text-sm leading-relaxed text-slate-700">{items}</ol>
      : <ul key={blocks.length} className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-700">{items}</ul>);
    list = null;
  };
  const flush = () => { flushPara(); flushList(); };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    const item = line.match(/^[-*•]\s+(.*)$/) ?? line.match(/^\d+[.)]\s+(.*)$/);
    if (!line) { flush(); continue; }
    if (heading) {
      flush();
      blocks.push(<h3 key={blocks.length} className="pt-2 text-base font-semibold text-brand-800">{inline(heading[1])}</h3>);
    } else if (item) {
      flushPara();
      const ordered = /^\d/.test(line);
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push(item[1]);
    } else {
      flushList();
      para.push(line);
    }
  }
  flush();
  return <div className="space-y-2">{blocks}</div>;
}

function fromUtc(s: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
}

/** Coach Claude : bilan des derniers jours, conseils et propositions, à partir de toutes les données de l'app. */
export function CoachCard() {
  const user = useCurrentUser();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [showData, setShowData] = useState(false);

  const report = useQuery({
    queryKey: ["coach", user.id],
    queryFn: () => api<CoachReport | null>(`/users/${user.id}/coach/`),
  });
  const context = useQuery({
    queryKey: ["coach_context", user.id],
    queryFn: () => api<unknown>(`/users/${user.id}/coach/context`),
    enabled: showData,
  });
  // Le week-end : préparer la semaine prochaine (par défaut) ou finir celle en cours
  const weekend = [0, 6].includes(new Date().getDay());
  const [choice, setChoice] = useState<"prochaine" | "courante">("prochaine");
  const semaine = weekend ? choice : "courante";
  const weeks = useQuery({
    queryKey: ["coach_weeks", user.id],
    queryFn: () => api<string[]>(`/users/${user.id}/coach/weeks`),
  });
  const ask = useMutation({
    mutationFn: () => api<CoachReport>(`/users/${user.id}/coach/`, { method: "POST", query: { semaine } }),
    onSuccess: (r) => {
      queryClient.setQueryData(["coach", user.id], r);
      queryClient.invalidateQueries({ queryKey: ["coach_weeks", user.id] });
      toast(semaine === "prochaine" ? "Ta semaine prochaine est prête" : "Ton bilan est prêt");
    },
    onError: (e) => toast(e.message, "error"),
  });

  const r = report.data;
  const at = r ? fromUtc(r.created_at) : null;
  // Un bilan par semaine préparée (du lundi au dimanche)
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const monday = (d: Date) => { const m = new Date(d); m.setHours(0, 0, 0, 0); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return m; };
  const thisMonday = monday(new Date());
  const nextMonday = new Date(thisMonday); nextMonday.setDate(nextMonday.getDate() + 7);
  const done = new Set(weeks.data ?? []);
  const targetMonday = semaine === "prochaine" ? nextMonday : thisMonday;
  const doneTarget = done.has(iso(targetMonday));
  const ddmm = (d: Date) => d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  const nextSunday = new Date(nextMonday); nextSunday.setDate(nextSunday.getDate() + 6);

  return (
    <Card title={<span className="inline-flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-violet-600" /> Coach</span>}>
      <p className="mb-3 text-sm text-slate-600">
        Le coach lit tes repas, ton sport, ton sommeil, ton poids, ta forme Garmin, ton agenda et ton frigo, puis te fait un bilan :
        santé et récupération, conseils, recettes, et des séances pour ta semaine à ajouter à l'agenda.
      </p>
      {!user.profil_coaching && (
        <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Pour des conseils vraiment adaptés, écris tes objectifs dans{" "}
          <Link to="/profil" className="font-medium underline">Profil → Mes infos & objectifs</Link>.
        </p>
      )}
      {weekend && (
        <div className="mb-3">
          <Segmented
            full
            value={choice}
            onChange={setChoice}
            options={[
              { value: "prochaine", label: `Semaine prochaine (${ddmm(nextMonday)} → ${ddmm(nextSunday)})` },
              { value: "courante", label: "Ce week-end" },
            ]}
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" disabled={ask.isPending || doneTarget || weeks.isLoading} onClick={() => ask.mutate()}>
          <Sparkles className="h-4 w-4" />
          {ask.isPending ? "Le coach analyse tes données…"
            : semaine === "prochaine" ? "Préparer ma semaine prochaine"
              : r ? "Nouveau bilan" : "Demander mon bilan"}
        </button>
        {ask.isPending && <span className="text-xs text-slate-500">Compte jusqu'à une minute.</span>}
        {doneTarget && !ask.isPending && (
          <span className="text-xs text-slate-500">
            {semaine === "prochaine"
              ? `Semaine du ${ddmm(nextMonday)} déjà préparée.`
              : weekend
                ? `Bilan de la semaine fait. Tu peux préparer la semaine prochaine.`
                : `Bilan de la semaine fait. Prochain possible le week-end, pour la semaine du ${ddmm(nextMonday)}.`}
          </span>
        )}
      </div>

      {report.isLoading ? <Spinner /> : r && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <div className="mb-2 text-xs text-slate-500">
            Bilan du {at!.toLocaleDateString("fr-FR")} à {at!.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
            {r.semaine_cible && at! < new Date(`${r.semaine_cible}T00:00`) && ` · pour la semaine du ${ddmm(new Date(`${r.semaine_cible}T12:00`))}`}
          </div>
          {r.donnees ? <StructuredReport report={r} /> : <CoachText text={r.texte} />}
          <p className="mt-4 text-xs text-slate-400">Conseils générés par une IA à partir de tes données : ils ne remplacent pas l'avis d'un professionnel de santé.</p>
        </div>
      )}

      <details className="mt-3 text-xs" onToggle={(e) => setShowData((e.target as HTMLDetailsElement).open)}>
        <summary className="cursor-pointer text-slate-500">Voir les données envoyées au coach</summary>
        {context.isLoading ? <Spinner /> : context.data ? (
          <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-slate-50 p-2 text-[11px] text-slate-700">{JSON.stringify(context.data, null, 2)}</pre>
        ) : null}
      </details>
    </Card>
  );
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="flex items-center gap-1.5 pt-2 text-base font-semibold text-brand-800">{icon} {title}</h3>
      {children}
    </section>
  );
}

function StructuredReport({ report }: { report: CoachReport }) {
  const d = report.donnees!;
  return (
    <div className="space-y-3">
      {d.remarques && (
        <Section icon={<Search className="h-4 w-4" />} title="Ce que je remarque sur les derniers jours"><CoachText text={d.remarques} /></Section>
      )}
      {d.sante_recuperation && (
        <div className="rounded-xl bg-rose-50/60 px-3 pb-2.5">
          <Section icon={<HeartPulse className="h-4 w-4 text-rose-600" />} title="Santé & récupération"><CoachText text={d.sante_recuperation} /></Section>
        </div>
      )}
      {d.ameliorations && (
        <Section icon={<Lightbulb className="h-4 w-4" />} title="Pour t'améliorer"><CoachText text={d.ameliorations} /></Section>
      )}
      {d.recettes.length > 0 && (
        <Section icon={<ChefHat className="h-4 w-4" />} title={d.recettes.length > 1 ? "Recettes" : "Recette"}>
          <div className="grid gap-3 md:grid-cols-2">
            {d.recettes.map((rec, i) => (
              <div key={i} className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3 text-sm">
                <div className="font-semibold text-slate-900">{rec.titre}</div>
                {rec.pourquoi && <div className="mb-2 text-xs text-emerald-800">{rec.pourquoi}</div>}
                {rec.ingredients.length > 0 && (
                  <ul className="mb-2 list-disc space-y-0.5 pl-5 text-slate-700">{rec.ingredients.map((x, j) => <li key={j}>{x}</li>)}</ul>
                )}
                {rec.etapes.length > 0 && (
                  <ol className="list-decimal space-y-0.5 pl-5 text-slate-700">{rec.etapes.map((x, j) => <li key={j}>{x}</li>)}</ol>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}
      <CoachActivities report={report} />
    </div>
  );
}

/** Séances conseillées pour la semaine : à cocher, puis « Ajouter les activités du coach ? ». */
function CoachActivities({ report }: { report: CoachReport }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const user = useCurrentUser();
  const acts = report.donnees!.activites;
  const today = todayISO();
  const [chosen, setChosen] = useState<Set<number>>(() => new Set(acts.map((a, i) => (a.date >= today ? i : -1)).filter((i) => i >= 0)));
  const added = !!report.activites_ajoutees_at;

  const add = useMutation({
    mutationFn: () => api<{ added: number; skipped: number }>(`/coach/${report.id}/activities`, {
      method: "POST", body: { indexes: [...chosen].sort((a, b) => a - b) },
    }),
    onSuccess: (res) => {
      queryClient.setQueryData(["coach", user.id], { ...report, activites_ajoutees_at: new Date().toISOString() });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast(`${res.added} activité${res.added > 1 ? "s" : ""} ajoutée${res.added > 1 ? "s" : ""} à l'agenda` +
        (res.skipped ? ` (${res.skipped} ignorée${res.skipped > 1 ? "s" : ""} : jour passé)` : ""));
    },
    onError: (e) => toast(e.message, "error"),
  });

  if (!acts.length) return null;
  return (
    <Section icon={<CalendarPlus className="h-4 w-4" />} title="Activités conseillées pour ta semaine">
      <ul className="space-y-1.5">
        {acts.map((a, i) => {
          const past = a.date < today;
          return (
            <li key={i}>
              <label className={`flex gap-3 rounded-xl border px-3 py-2 text-sm ${chosen.has(i) && !added ? "border-violet-200 bg-violet-50/60" : "border-slate-100 bg-white"} ${added || past ? "" : "cursor-pointer"}`}>
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 shrink-0 accent-violet-600"
                  checked={chosen.has(i)}
                  disabled={added || past}
                  onChange={(e) => {
                    const next = new Set(chosen);
                    if (e.target.checked) next.add(i); else next.delete(i);
                    setChosen(next);
                  }}
                />
                <span className="min-w-0">
                  <span className="block text-xs font-medium text-violet-700">{formatLong(a.date)}{past ? " (passé)" : ""}</span>
                  <span className="block font-medium text-slate-900">{a.titre}</span>
                  <span className="block text-xs text-slate-500">
                    {a.sport}{a.duree_min ? ` · ${a.duree_min} min` : ""}{a.details ? ` · ${a.details}` : ""}
                  </span>
                  {a.etapes && a.etapes.length > 0 && <span className="mt-1.5 block"><SeanceSteps steps={a.etapes} /></span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {added ? (
        <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-700">
          <Check className="h-4 w-4" /> Ajoutées à ton agenda (badge « Coach »). Ouvre une séance de course pour l'envoyer sur ta montre.
        </p>
      ) : (
        <button type="button" className="btn-primary bg-violet-600 hover:bg-violet-700" disabled={add.isPending || chosen.size === 0} onClick={() => add.mutate()}>
          <CalendarPlus className="h-4 w-4" /> Ajouter les activités du coach ?{chosen.size ? ` (${chosen.size})` : ""}
        </button>
      )}
    </Section>
  );
}
