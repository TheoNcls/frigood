import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import Layout from "./components/Layout";
import { Spinner } from "./components/ui";
import Login from "./pages/Login";
import Home from "./pages/Home";
import Meals from "./pages/Meals";
import Fridge from "./pages/Fridge";
import Profile from "./pages/Profile";

// Pages lourdes (calendrier, graphiques) chargées à la demande
const Agenda = lazy(() => import("./pages/Agenda"));
const History = lazy(() => import("./pages/History"));
const Admin = lazy(() => import("./admin"));

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!user) return <Login />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="repas" element={user.nutrition_active ? <Meals /> : <Navigate to="/" replace />} />
        <Route path="frigo" element={<Fridge />} />
        <Route path="agenda" element={<Suspense fallback={<Spinner />}><Agenda /></Suspense>} />
        <Route path="sport" element={<Navigate to="/agenda" replace />} />
        <Route path="historique" element={<Suspense fallback={<Spinner />}><History /></Suspense>} />
        <Route path="profil" element={<Profile />} />
        {user.is_admin && <Route path="admin/*" element={<Suspense fallback={<Spinner />}><Admin /></Suspense>} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
