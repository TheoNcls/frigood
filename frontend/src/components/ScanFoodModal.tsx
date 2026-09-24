import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "../api/client";
import { useNutriments } from "../api/queries";
import type { Ingredient, IngredientInput, IngredientSuggestion, NutrimentSuggestion } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import IngredientForm from "../admin/IngredientForm";
import { createIngredient, useInvalidateCatalog } from "../admin/catalog";
import BarcodeScanner from "./BarcodeScanner";
import FoodThumb from "./FoodThumb";
import Modal from "./Modal";
import { useToast } from "./Toast";
import { ErrorMessage, Segmented, Spinner } from "./ui";

type Phase =
  | { step: "scan" }
  | { step: "unknown"; code: string }
  | { step: "create"; code: string; suggestion: IngredientSuggestion | null };

/** Scan d'un produit pour le Frigo ou les Repas : sélectionne l'ingrédient connu, ou propose de le créer (admin). */
export default function ScanFoodModal({ onSelect, onClose }: {
  onSelect: (ingredient: Ingredient) => void;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const invalidate = useInvalidateCatalog();
  const nutriments = useNutriments();
  const toast = useToast();
  const [how, setHow] = useState<"scan" | "type">("scan");
  const [typed, setTyped] = useState("");
  const [scanKey, setScanKey] = useState(0);
  const [phase, setPhase] = useState<Phase>({ step: "scan" });

  function select(ingredient: Ingredient) {
    // Visible tout de suite dans les listes, sans attendre le rechargement du catalogue
    queryClient.setQueryData<Ingredient[]>(["ingredients"], (old) =>
      old && !old.some((i) => i.id === ingredient.id) ? [...old, ingredient] : old,
    );
    onSelect(ingredient);
    onClose();
  }

  const lookup = useMutation({
    mutationFn: (code: string) => api<Ingredient>(`/ingredients/by_barcode/${encodeURIComponent(code)}`),
    onSuccess: (ingredient) => {
      toast(`${ingredient.nom} sélectionné`);
      select(ingredient);
    },
    onError: (e, code) => {
      if (e instanceof ApiError && e.status === 404) setPhase({ step: "unknown", code });
    },
  });

  const fetchOff = useMutation({
    mutationFn: (code: string) => api<IngredientSuggestion>("/ingredients/from_barcode", { query: { code } }),
    onSuccess: (suggestion, code) => setPhase({ step: "create", code, suggestion }),
  });

  const save = useMutation({
    mutationFn: ({ values, nuts, code, suggestion }: {
      values: IngredientInput; nuts: NutrimentSuggestion[]; code: string; suggestion: IngredientSuggestion | null;
    }) => createIngredient(values, nuts, {
      type: suggestion ? "openfoodfacts" : "manual",
      // Code-barre gardé même en saisie manuelle : le prochain scan retrouvera le produit
      codeBarre: code,
      rawData: suggestion?.raw_data,
    }, nutriments.list),
    onSuccess: ({ ingredient }) => {
      invalidate();
      toast(`« ${ingredient.nom} » ajouté au catalogue`);
      select(ingredient);
    },
    onError: (e) => toast(e.message, "error"),
  });

  function search(code: string) {
    const clean = code.replace(/\s/g, "");
    if (clean) lookup.mutate(clean);
  }

  function restart() {
    lookup.reset();
    fetchOff.reset();
    setPhase({ step: "scan" });
    setScanKey((k) => k + 1);
  }

  const title = phase.step === "create" ? "Nouveau produit" : "Scanner un produit";

  return (
    <Modal title={title} onClose={onClose} wide={phase.step === "create"}>
      {phase.step === "scan" && (
        <div className="space-y-3">
          <Segmented
            value={how}
            onChange={(v) => { setHow(v); lookup.reset(); }}
            options={[{ value: "scan", label: "Caméra" }, { value: "type", label: "Saisir le code" }]}
          />
          {how === "scan" ? (
            lookup.isPending ? null : <BarcodeScanner key={scanKey} onDetected={search} />
          ) : (
            <form className="flex gap-2" onSubmit={(e: FormEvent) => { e.preventDefault(); search(typed); }}>
              <input className="input" inputMode="numeric" autoFocus placeholder="ex. 3017624010701" value={typed} onChange={(e) => setTyped(e.target.value)} />
              <button type="submit" className="btn-primary shrink-0" disabled={lookup.isPending || !typed.trim()}>Rechercher</button>
            </form>
          )}
          {lookup.isPending && <Spinner label="Recherche dans le catalogue…" />}
          {lookup.isError && !(lookup.error instanceof ApiError && lookup.error.status === 404) && (
            <>
              <ErrorMessage error={lookup.error} />
              <button className="btn-secondary" onClick={restart}>Réessayer</button>
            </>
          )}
        </div>
      )}

      {phase.step === "unknown" && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-xl bg-amber-50 px-3 py-3 text-sm text-amber-900">
            <FoodThumb nom="" size="md" />
            <div>
              <div className="font-medium">Produit inconnu du catalogue</div>
              <div className="text-xs">Code {phase.code}</div>
            </div>
          </div>
          {user?.is_admin ? (
            <>
              <div className="flex flex-wrap gap-2">
                <button className="btn-primary" disabled={fetchOff.isPending} onClick={() => fetchOff.mutate(phase.code)}>
                  {fetchOff.isPending ? "Recherche sur OpenFoodFacts…" : "L'ajouter depuis OpenFoodFacts"}
                </button>
                <button className="btn-secondary" onClick={() => setPhase({ step: "create", code: phase.code, suggestion: null })}>
                  Le saisir à la main
                </button>
                <button className="btn-ghost" onClick={restart}>Scanner un autre produit</button>
              </div>
              {fetchOff.isError && <ErrorMessage error={fetchOff.error} />}
            </>
          ) : (
            <>
              <p className="text-sm text-slate-600">
                Demande à l'administrateur de l'ajouter, ou choisis un ingrédient équivalent dans la liste.
              </p>
              <button className="btn-secondary" onClick={restart}>Scanner un autre produit</button>
            </>
          )}
        </div>
      )}

      {phase.step === "create" && (
        <div className="space-y-4">
          <p className={`rounded-xl px-3 py-2 text-sm ${phase.suggestion ? "bg-emerald-50 text-emerald-800" : "bg-slate-50 text-slate-600"}`}>
            {phase.suggestion
              ? `✅ Données OpenFoodFacts pour le code ${phase.code} : vérifie avant d'ajouter.`
              : `Saisie manuelle : le code ${phase.code} sera associé à ce produit pour les prochains scans.`}
          </p>
          <IngredientForm
            initial={phase.suggestion ?? {}}
            submitLabel="Ajouter au catalogue et sélectionner"
            pending={save.isPending}
            onSubmit={(values, nuts) => save.mutate({ values, nuts, code: phase.code, suggestion: phase.suggestion })}
            onCancel={restart}
          />
        </div>
      )}
    </Modal>
  );
}
