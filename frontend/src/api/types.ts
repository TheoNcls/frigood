export interface User {
  id: number;
  nom: string;
  email: string;
  calories_cible: number | null;
  proteines_cible: number | null;
  glucides_cible: number | null;
  lipides_cible: number | null;
  garmin_connected: boolean;
  is_admin: boolean;
}

export interface AuthResponse extends User {
  access_token: string;
  token_type: string;
}

export interface Nutriment {
  id: number;
  nom: string;
  unite: string;
}

export interface IngredientNutriment {
  id: number;
  nutriment_id: number;
  valeur: number;
  notes: string | null;
  nutriment: Nutriment;
}

export interface Ingredient {
  id: number;
  nom: string;
  description: string | null;
  categorie: string | null;
  calories: number | null;
  proteines: number | null;
  glucides: number | null;
  lipides: number | null;
  unite: string;
  quantite_defaut: number | null;
  duree_conservation: number | null;
  nutriscore: NutriScore | null;
  greenscore: GreenScore | null;
  nova: Nova | null;
  regime: Regime | null;
  image_url: string | null;
  nutriments: IngredientNutriment[];
  sources: IngredientSource[];
}

export type NutriScore = "a" | "b" | "c" | "d" | "e";
export type GreenScore = "a-plus" | "a" | "b" | "c" | "d" | "e" | "f";
export type Nova = 1 | 2 | 3 | 4;
export type Regime = "vegan" | "vegetarien" | "non_vegetarien" | "incertain";

export interface IngredientSource {
  id: number;
  ingredient_id: number;
  source_type: string;
  code_barre: string | null;
  created_at: string | null;
}

/** Champs modifiables d'un ingrédient (création / modification). */
export interface IngredientInput {
  nom: string;
  description: string | null;
  categorie: string | null;
  calories: number | null;
  proteines: number | null;
  glucides: number | null;
  lipides: number | null;
  unite: string;
  quantite_defaut: number | null;
  duree_conservation: number | null;
  nutriscore: NutriScore | null;
  greenscore: GreenScore | null;
  nova: Nova | null;
  regime: Regime | null;
  image_url: string | null;
}

export interface NutrimentSuggestion {
  nom: string;
  unite: string;
  valeur: number;
}

/** Réponse de /ingredients/from_claude et /ingredients/from_barcode. */
export interface IngredientSuggestion extends Partial<IngredientInput> {
  /** Catégories OpenFoodFacts en français, de la plus précise à la plus générale. */
  categories?: string[];
  /** Ingrédients qui rendent le produit non végétarien (ou douteux), selon OpenFoodFacts */
  regime_causes?: string[];
  nutriments?: NutrimentSuggestion[];
  raw_data?: string;
  code_barre?: string;
}

export interface RecipeInput {
  nom: string;
  description: string | null;
  categorie: string | null;
  portions: number | null;
  temps_preparation: number | null;
}

export type TypeMesure = "poids" | "unite";

export interface RecipeIngredient {
  id: number;
  ingredient_id: number;
  quantite: number;
  type_mesure: TypeMesure;
  ingredient: Ingredient;
}

export interface Recipe {
  id: number;
  nom: string;
  description: string | null;
  categorie: string | null;
  portions: number | null;
  temps_preparation: number | null;
  ingredients: RecipeIngredient[];
}

export type Moment = "matin" | "midi" | "soir" | "snack";

export interface MealLog {
  id: number;
  user_id: number;
  date: string;
  moment: Moment;
  recipe_id: number | null;
  ingredient_id: number | null;
  quantite: number | null;
  type_mesure: TypeMesure;
  notes: string | null;
  fridge_updates: string[];
}

export interface MealLogCreate {
  date: string;
  moment: Moment;
  recipe_id: number | null;
  ingredient_id: number | null;
  quantite: number;
  type_mesure: TypeMesure;
  notes: string | null;
}

export interface ActivityType {
  id: number;
  nom: string;
  description: string | null;
  met_value: number | null;
  garmin_type_key: string | null;
}

export interface Activity {
  id: number;
  user_id: number;
  date: string;
  activity_type_id: number | null;
  source: "manual" | "garmin";
  garmin_activity_id: string | null;
  duree_min: number | null;
  calories: number | null;
  distance_km: number | null;
  freq_cardiaque_moy: number | null;
  notes: string | null;
  activity_type: ActivityType | null;
}

export interface DailyStat {
  id: number;
  user_id: number;
  date: string;
  sommeil_total_h: number | null;
  sommeil_profond_h: number | null;
  sommeil_leger_h: number | null;
  sommeil_rem_h: number | null;
  sommeil_eveil_h: number | null;
  sommeil_score: number | null;
  heure_coucher: string | null;
  heure_reveil: string | null;
  bpm_repos: number | null;
  bpm_moy: number | null;
  bpm_min: number | null;
  bpm_max: number | null;
  stress_moy: number | null;
  stress_max: number | null;
  body_battery_max: number | null;
  body_battery_min: number | null;
  steps: number | null;
  steps_goal: number | null;
  etages: number | null;
  respiration_moy: number | null;
  spo2_moy: number | null;
  hrv_moy: number | null;
}

export interface FridgeItem {
  id: number;
  user_id: number;
  ingredient_id: number | null;
  recipe_id: number | null;
  quantite: number;
  date_achat: string | null;
  date_peremption: string | null;
  created_at: string | null;
}

export type FridgeAction = "ajout" | "repas" | "cuisine" | "modification" | "consomme" | "perime" | "suppression";

export interface FridgeHistory {
  id: number;
  ingredient_id: number | null;
  recipe_id: number | null;
  quantite: number;
  action: FridgeAction;
  meal_log_id: number | null;
  date_achat: string | null;
  date_peremption: string | null;
  notes: string | null;
  created_at: string | null;
}

export interface GarminSyncResult {
  imported: number;
  skipped: number;
  stats_days: number;
  /** Jours encore à récupérer (synchronisation par lots) */
  remaining_days: number;
}

export type Recurrence = "daily" | "weekly" | "monthly";

export interface TaskInput {
  titre: string;
  notes: string | null;
  date: string;
  heure: string | null;
  recurrence: Recurrence | null;
  recurrence_fin: string | null;
}

/** Une tâche à une date donnée (les tâches récurrentes ont une occurrence par jour concerné). */
export interface TaskOccurrence {
  task_id: number;
  date: string;
  titre: string;
  notes: string | null;
  heure: string | null;
  recurrence: Recurrence | null;
  recurrence_fin: string | null;
  serie_debut: string;
  fait: boolean;
  done_at: string | null;
}
