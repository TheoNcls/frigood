import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import { useAuth } from "../auth/AuthContext";
import type {
  Activity, ActivityType, DailyStat, FridgeHistory, FridgeItem, Ingredient, MealLog, Recipe,
} from "./types";

const CATALOG_STALE = 2 * 60 * 1000;
const EMPTY: never[] = [];

function useById<T extends { id: number }>(data: T[] | undefined): Map<number, T> {
  return useMemo(() => new Map((data ?? []).map((x) => [x.id, x])), [data]);
}

export function useIngredients() {
  const query = useQuery({
    queryKey: ["ingredients"],
    queryFn: () => api<Ingredient[]>("/ingredients/"),
    staleTime: CATALOG_STALE,
  });
  const byId = useById(query.data);
  return { ...query, list: query.data ?? EMPTY, byId };
}

export function useRecipes() {
  const query = useQuery({
    queryKey: ["recipes"],
    queryFn: () => api<Recipe[]>("/recipes/"),
    staleTime: CATALOG_STALE,
  });
  const byId = useById(query.data);
  return { ...query, list: query.data ?? EMPTY, byId };
}

export function useActivityTypes() {
  const query = useQuery({
    queryKey: ["activity_types"],
    queryFn: () => api<ActivityType[]>("/activity_types/"),
    staleTime: CATALOG_STALE,
  });
  const byId = useById(query.data);
  return { ...query, list: query.data ?? EMPTY, byId };
}

export interface DateFilter {
  date?: string;
  date_from?: string;
  date_to?: string;
}

function useUserId(): number {
  const { user } = useAuth();
  if (!user) throw new Error("Utilisateur non connecté");
  return user.id;
}

export function useMealLogs(filter: DateFilter = {}) {
  const uid = useUserId();
  return useQuery({
    queryKey: ["meal_logs", uid, filter],
    queryFn: () => api<MealLog[]>(`/users/${uid}/meal_logs/`, { query: { ...filter } }),
  });
}

export function useActivities(filter: DateFilter = {}) {
  const uid = useUserId();
  return useQuery({
    queryKey: ["activities", uid, filter],
    queryFn: () => api<Activity[]>(`/users/${uid}/activities/`, { query: { ...filter } }),
  });
}

export function useDailyStat(date: string) {
  const uid = useUserId();
  return useQuery({
    queryKey: ["daily_stats", uid, date],
    queryFn: () => api<DailyStat | null>(`/users/${uid}/daily_stats/`, { query: { date } }),
  });
}

export function useDailyStatsRange(date_from: string, date_to: string) {
  const uid = useUserId();
  return useQuery({
    queryKey: ["daily_stats", uid, "range", date_from, date_to],
    queryFn: () => api<DailyStat[]>(`/users/${uid}/daily_stats/range`, { query: { date_from, date_to } }),
  });
}

export function useFridge() {
  const uid = useUserId();
  return useQuery({
    queryKey: ["fridge", uid],
    queryFn: () => api<FridgeItem[]>(`/users/${uid}/fridge/`),
  });
}

export function useFridgeHistory() {
  const uid = useUserId();
  return useQuery({
    queryKey: ["fridge_history", uid],
    queryFn: () => api<FridgeHistory[]>(`/users/${uid}/fridge/history`, { query: { limit: 200 } }),
  });
}
