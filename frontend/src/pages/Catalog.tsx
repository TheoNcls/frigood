import { useState } from "react";
import IngredientsAdmin from "../admin/IngredientsAdmin";
import RecipesAdmin from "../admin/RecipesAdmin";
import { PageHeader, Segmented } from "../components/ui";

/** Catalogue pour tout le monde : les ingrédients et recettes validés, plus les siens (seuls ceux-là sont modifiables). */
export default function Catalog() {
  const [tab, setTab] = useState<"ingredients" | "recettes">("ingredients");
  return (
    <div className="space-y-4">
      <PageHeader title="Catalogue" subtitle="Ajoute tes ingrédients et tes recettes ; ceux des autres sont en lecture seule" />
      <Segmented
        full
        value={tab}
        onChange={setTab}
        options={[{ value: "ingredients", label: "Ingrédients" }, { value: "recettes", label: "Recettes" }]}
      />
      {tab === "ingredients" ? <IngredientsAdmin mode="user" /> : <RecipesAdmin mode="user" />}
    </div>
  );
}
