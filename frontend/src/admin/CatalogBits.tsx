import { Segmented } from "../components/ui";

/** Administration : tout le catalogue, tout modifiable. Utilisateur : le catalogue validé + le sien, seul le sien modifiable. */
export type CatalogMode = "admin" | "user";
export type CatalogScope = "tout" | "miens" | "a_valider";

interface Owned {
  valide: boolean;
  created_by: number;
  created_by_nom: string | null;
}

export function canEditItem(item: Owned, mode: CatalogMode, meId: number): boolean {
  return mode === "admin" || item.created_by === meId;
}

export function inScope(item: Owned, scope: CatalogScope, meId: number): boolean {
  if (scope === "miens") return item.created_by === meId;
  if (scope === "a_valider") return !item.valide;
  return true;
}

/** Filtre du haut : « Catalogue » (validé + le sien) ou « Mes … » ; pour l'administration, « À valider ». */
export function ScopeFilter({ mode, value, onChange, mine }: {
  mode: CatalogMode;
  value: CatalogScope;
  onChange: (v: CatalogScope) => void;
  mine: string;
}) {
  const options: { value: CatalogScope; label: string }[] = mode === "admin"
    ? [{ value: "tout", label: "Tout" }, { value: "a_valider", label: "À valider" }, { value: "miens", label: mine }]
    : [{ value: "tout", label: "Catalogue" }, { value: "miens", label: mine }];
  return <Segmented value={value} onChange={onChange} options={options} />;
}

/** « à moi », « à valider » (et, pour l'administration, qui l'a ajouté). */
export function OwnerBadges({ item, mode, meId }: { item: Owned; mode: CatalogMode; meId: number }) {
  const mine = item.created_by === meId;
  return (
    <>
      {mine && <span className="badge bg-brand-50 text-brand-700">à moi</span>}
      {!item.valide && (
        <span className="badge bg-amber-100 text-amber-800" title="Visible seulement par la personne qui l'a ajouté">
          à valider{mode === "admin" && !mine && item.created_by_nom ? ` · ${item.created_by_nom}` : ""}
        </span>
      )}
    </>
  );
}
