import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useCurrentUser } from "../auth/AuthContext";
import { PageHeader } from "../components/ui";
import ActivityTypesAdmin from "./ActivityTypesAdmin";
import DataAdmin from "./DataAdmin";
import IngredientsAdmin from "./IngredientsAdmin";
import NutrimentsAdmin from "./NutrimentsAdmin";
import RecipesAdmin from "./RecipesAdmin";

const TABS = [
  { to: "ingredients", label: "Ingrédients" },
  { to: "recettes", label: "Recettes" },
  { to: "nutriments", label: "Nutriments" },
  { to: "activites", label: "Types d'activité" },
  { to: "donnees", label: "Données" },
];

export default function Admin() {
  const user = useCurrentUser();
  if (!user.is_admin) return <Navigate to="/" replace />;

  return (
    <div className="space-y-4">
      <PageHeader title="Administration" subtitle="Catalogue partagé par tous les utilisateurs" />
      <nav className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="segmented">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                  isActive ? "bg-white text-slate-900 shadow-sm" : "text-slate-600"
                }`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <Routes>
        <Route index element={<Navigate to="ingredients" replace />} />
        <Route path="ingredients" element={<IngredientsAdmin />} />
        <Route path="recettes" element={<RecipesAdmin />} />
        <Route path="nutriments" element={<NutrimentsAdmin />} />
        <Route path="activites" element={<ActivityTypesAdmin />} />
        <Route path="donnees" element={<DataAdmin />} />
        <Route path="*" element={<Navigate to="ingredients" replace />} />
      </Routes>
    </div>
  );
}
