import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, getToken, setToken, setUnauthorizedHandler } from "../api/client";
import type { AuthResponse, User } from "../api/types";

export interface RegisterData {
  nom: string;
  email: string;
  password: string;
  calories_cible: number | null;
  proteines_cible: number | null;
  glucides_cible: number | null;
  lipides_cible: number | null;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function stripToken({ access_token: _t, token_type: _tt, ...user }: AuthResponse): User {
  return user;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(() => getToken() !== null);
  const queryClient = useQueryClient();

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  const refreshUser = useCallback(async () => {
    setUser(await api<User>("/users/me"));
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    refreshUser()
      .catch(() => logout())
      .finally(() => setLoading(false));
  }, [refreshUser, logout]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<AuthResponse>("/users/login", { method: "POST", body: { email, password } });
    setToken(res.access_token);
    setUser(stripToken(res));
  }, []);

  const register = useCallback(async (data: RegisterData) => {
    const res = await api<AuthResponse>("/users/", { method: "POST", body: data });
    setToken(res.access_token);
    setUser(stripToken(res));
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth doit être utilisé dans AuthProvider");
  return ctx;
}

export function useCurrentUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error("Utilisateur non connecté");
  return user;
}
