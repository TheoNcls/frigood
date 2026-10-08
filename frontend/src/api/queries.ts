import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import { useAuth } from "../auth/AuthContext";
import type {
  Activity, ActivityType, BodyComposition, DailyStat, FitnessMetric, FridgeHistory, FridgeItem, Ingredient, MealLog, Nutriment, Recipe,
  PlanMilestone, TaskOccurrence,
} from "./types";

const CATALOG_STALE = 2 * 60 * 1000;
const EMPTY: never[] = [];

function useById<T extends { id: number }>(data: T[] | undefined): Map<number, T> {
  return useMemo(() => new Map((data ?? []).map((x) => [x.id, x])), [data]);
}

/** Ingrédients validés et ceux de la personne ; `tous` (administration) : tout le catalogue. */
export function useIngredients({ tous = false }: { tous?: boolean } = {}) {
  const query = useQuery({
    queryKey: tous ? ["ingredients", "tous"] : ["ingredients"],
    queryFn: () => api<Ingredient[]>("/ingredients/", { query: tous ? { tous: true } : {} }),
    staleTime: CATALOG_STALE,
  });
  const byId = useById(query.data);
  return { ...query, list: query.data ?? EMPTY, byId };
}

/** Recettes validées et celles de la personne ; `tous` (administration) : toutes. */
export function useRecipes({ tous = false }: { tous?: boolean } = {}) {
  const query = useQuery({
    queryKey: tous ? ["recipes", "tous"] : ["recipes"],
    queryFn: () => api<Recipe[]>("/recipes/", { query: tous ? { tous: true } : {} }),
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

export function useNutriments() {
  const query = useQuery({
    queryKey: ["nutriments"],
    queryFn: () => api<Nutriment[]>("/nutriments/"),
    staleTime: CATALOG_STALE,
  });
  return { ...query, list: query.data ?? EMPTY };
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

/** Jalon en cours du plan (null sans plan, ou si ses dates ne sont pas lisibles). */
export function usePlanMilestone() {
  const uid = useUserId();
  return useQuery({
    queryKey: ["plan_jalon", uid],
    queryFn: () => api<PlanMilestone | null>(`/users/${uid}/plan/jalon`),
  });
}

export function useFridge() {
  const uid = useUserId();
  return useQuery({
    queryKey: ["fridge", uid],
    queryFn: () => api<FridgeItem[]>(`/users/${uid}/fridge/`),
  });
}

export function useFridgeHistory({ enabled = true }: { enabled?: boolean } = {}) {
  const uid = useUserId();
  return useQuery({
    queryKey: ["fridge_history", uid],
    queryFn: () => api<FridgeHistory[]>(`/users/${uid}/fridge/history`, { query: { limit: 200 } }),
    enabled,
  });
}

export function useTasks(date_from: string, date_to: string) {
  const uid = useUserId();
  return useQuery({
    queryKey: ["tasks", uid, date_from, date_to],
    queryFn: () => api<TaskOccurrence[]>(`/users/${uid}/tasks/`, { query: { date_from, date_to } }),
  });
}

export function useBody(date_from: string, date_to: string) {
  const uid = useUserId();
  return useQuery({
    queryKey: ["body", uid, date_from, date_to],
    queryFn: () => api<BodyComposition[]>(`/users/${uid}/body/`, { query: { date_from, date_to } }),
  });
}

export function useFitness(date_from: string, date_to: string) {
  const uid = useUserId();
  return useQuery({
    queryKey: ["fitness", uid, date_from, date_to],
    queryFn: () => api<FitnessMetric[]>(`/users/${uid}/fitness/`, { query: { date_from, date_to } }),
  });
}
