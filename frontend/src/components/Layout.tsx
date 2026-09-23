import { NavLink, Outlet } from "react-router-dom";
import { Activity, CalendarDays, Home, LogOut, Refrigerator, User, UtensilsCrossed } from "lucide-react";
import { useAuth } from "../auth/AuthContext";

const NAV = [
  { to: "/", label: "Accueil", icon: Home, end: true },
  { to: "/repas", label: "Repas", icon: UtensilsCrossed },
  { to: "/frigo", label: "Frigo", icon: Refrigerator },
  { to: "/sport", label: "Sport", icon: Activity },
  { to: "/historique", label: "Historique", icon: CalendarDays },
  { to: "/profil", label: "Profil", icon: User },
];

export default function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white px-4 py-6 lg:flex lg:sticky lg:top-0 lg:h-screen">
        <div className="mb-8 flex items-center gap-2 px-2 text-xl font-bold text-brand-700">
          <span aria-hidden>🥦</span> Frigood
        </div>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition ${
                  isActive ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100"
                }`
              }
            >
              <Icon className="h-4 w-4" /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-200 px-2 pt-4">
          <div className="truncate text-sm font-medium text-slate-800">{user?.nom}</div>
          <div className="truncate text-xs text-slate-500">{user?.email}</div>
          <button onClick={logout} className="btn-ghost mt-3 w-full justify-start px-0">
            <LogOut className="h-4 w-4" /> Déconnexion
          </button>
        </div>
      </aside>

      <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-6 sm:px-6 lg:pb-10 lg:pt-8">
        <Outlet />
      </main>

      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-slate-200 bg-white/95 backdrop-blur lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium ${isActive ? "text-brand-700" : "text-slate-500"}`
            }
          >
            <Icon className="h-5 w-5" />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
