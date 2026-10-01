import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { api } from "../api/client";
import { useCurrentUser } from "../auth/AuthContext";
import { useToast } from "./Toast";
import { Card, Spinner } from "./ui";

interface CoachReport {
  id: number;
  created_at: string;
  texte: string;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
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
  const ask = useMutation({
    mutationFn: () => api<CoachReport>(`/users/${user.id}/coach/`, { method: "POST" }),
    onSuccess: (r) => { queryClient.setQueryData(["coach", user.id], r); toast("Ton bilan est prêt"); },
    onError: (e) => toast(e.message, "error"),
  });

  const r = report.data;
  const at = r ? fromUtc(r.created_at) : null;

  return (
    <Card title={<span className="inline-flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-violet-600" /> Coach</span>}>
      <p className="mb-3 text-sm text-slate-600">
        Le coach lit tes repas, ton sport, ton sommeil, ton poids, ta forme Garmin, ton agenda et ton frigo, puis te fait un bilan
        avec des conseils et des propositions pour la suite.
      </p>
      {!user.profil_coaching && (
        <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Pour des conseils vraiment adaptés, écris tes objectifs dans{" "}
          <Link to="/profil" className="font-medium underline">Profil → Mes infos & objectifs</Link>.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" disabled={ask.isPending} onClick={() => ask.mutate()}>
          <Sparkles className="h-4 w-4" />
          {ask.isPending ? "Le coach analyse tes données…" : r ? "Nouveau bilan" : "Demander mon bilan"}
        </button>
        {ask.isPending && <span className="text-xs text-slate-500">Compte jusqu'à une minute.</span>}
      </div>

      {report.isLoading ? <Spinner /> : r && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <div className="mb-2 text-xs text-slate-500">
            Bilan du {at!.toLocaleDateString("fr-FR")} à {at!.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
          </div>
          <CoachText text={r.texte} />
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
