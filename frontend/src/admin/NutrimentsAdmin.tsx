import { useMemo, useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { api } from "../api/client";
import { useIngredients, useNutriments } from "../api/queries";
import { useToast } from "../components/Toast";
import { Card, ConfirmButton, Empty, Field, Spinner } from "../components/ui";
import { useInvalidateCatalog } from "./catalog";

export default function NutrimentsAdmin() {
  const nutriments = useNutriments();
  const ingredients = useIngredients();
  const invalidate = useInvalidateCatalog();
  const toast = useToast();
  const [nom, setNom] = useState("");
  const [unite, setUnite] = useState("mg");

  const usage = useMemo(() => {
    const m = new Map<number, number>();
    for (const i of ingredients.list) for (const n of i.nutriments) m.set(n.nutriment_id, (m.get(n.nutriment_id) ?? 0) + 1);
    return m;
  }, [ingredients.list]);

  const add = useMutation({
    mutationFn: () => api("/nutriments/", { method: "POST", body: { nom: nom.trim(), unite: unite.trim() || "g" } }),
    onSuccess: () => { invalidate(); toast(`Nutriment « ${nom.trim()} » ajouté`); setNom(""); },
    onError: (e) => toast(e.message, "error"),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`/nutriments/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
    onError: (e) => toast(e.message, "error"),
  });

  const rows = [...nutriments.list].sort((a, b) => a.nom.localeCompare(b.nom, "fr"));

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500">
        Nutriments au-delà des 4 classiques (fibres, vitamines, fer…). Leurs valeurs se saisissent dans la fiche de chaque ingrédient.
      </p>
      <Card title="Nouveau nutriment">
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e: FormEvent) => { e.preventDefault(); if (nom.trim()) add.mutate(); }}>
          <div className="min-w-[12rem] flex-1">
            <Field label="Nom"><input className="input" required placeholder="ex. Vitamine B12" value={nom} onChange={(e) => setNom(e.target.value)} /></Field>
          </div>
          <div className="w-28">
            <Field label="Unité"><input className="input" required placeholder="g, mg, µg" value={unite} onChange={(e) => setUnite(e.target.value)} /></Field>
          </div>
          <button type="submit" className="btn-primary" disabled={add.isPending}><Plus className="h-4 w-4" /> Ajouter</button>
        </form>
      </Card>

      <Card className="p-0 sm:p-0">
        {nutriments.isLoading ? <div className="px-4"><Spinner /></div> : !rows.length ? <div className="px-4"><Empty>Aucun nutriment pour l'instant.</Empty></div> : (
          <ul className="divide-y divide-slate-100">
            {rows.map((n) => {
              const count = usage.get(n.id) ?? 0;
              return (
                <li key={n.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="flex-1 font-medium text-slate-900">{n.nom}</span>
                  <span className="w-12 text-slate-500">{n.unite}</span>
                  <span className="w-28 text-right text-xs text-slate-500">{count ? `${count} ingrédient(s)` : "inutilisé"}</span>
                  <ConfirmButton compact label={`Supprimer ${n.nom}`} confirmLabel="Supprimer" disabled={remove.isPending} onConfirm={() => remove.mutate(n.id)} />
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
