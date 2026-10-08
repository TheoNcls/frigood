export interface User {
  id: number;
  nom: string;
  email: string;
  calories_cible: number | null;
  proteines_cible: number | null;
  glucides_cible: number | null;
  lipides_cible: number | null;
  /** Objectif protéines en g/kg : proteines_cible suit alors le dernier poids */
  proteines_g_kg: number | null;
  date_naissance: string | null;
  /** Infos et objectifs en texte libre (futur coaching personnalisé) */
  profil_coaching: string | null;
  /** Plan à long terme vers les objectifs (Markdown), généré une fois par le coach puis modifiable */
  plan_objectifs: string | null;
  plan_genere_at: string | null;
  regime_alimentaire: RegimeAlimentaire;
  /** Partie Nutrition affichée (masquée sinon : repas, objectifs, calories ; les données restent) */
  nutrition_active: boolean;
  /** Nutriments suivis sur l'accueil, avec la valeur visée */
  nutriments_suivis: NutrimentSuivi[];
  /** Matériel de renfo disponible (null : pas renseigné, le coach a tous les exercices) */
  materiel: string[] | null;
  /** Zones cardiaques Garmin (profil course) */
  zones_fc: { profil: string; fc_max: number | null; fc_repos: number | null; zones: { zone: number; min: number; max: number | null }[] } | null;
  garmin_connected: boolean;
  /** Synchro Garmin automatique à l'ouverture de l'appli, si la dernière date de plus de 2 h (réglage du compte) */
  garmin_auto_sync: boolean;
  /** Dernière synchro réussie (manuelle ou automatique), en UTC */
  garmin_last_sync_at: string | null;
  garmin_last_sync_auto: boolean | null;
  garmin_last_sync_activities: number | null;
  garmin_last_sync_days: number | null;
  is_admin: boolean;
  /** Coach IA activé par l'administration (l'administration y a toujours accès) */
  coach_autorise: boolean;
  coach_access: boolean;
}

export interface NutrimentSuivi {
  nutriment_id: number;
  cible: number | null;
  /** « min » : à atteindre ; « max » : à ne pas dépasser */
  sens: "min" | "max";
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
  /** Liste des ingrédients d'un produit transformé */
  composition: string | null;
  /** Validé : visible par tout le monde ; sinon seulement par la personne qui l'a créé */
  valide: boolean;
  /** Utilisateur qui l'a ajouté au catalogue (0 = inconnu) */
  created_by: number;
  created_by_nom: string | null;
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
  composition: string | null;
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
  /** Coché par défaut à la préparation ; sinon une option (non comptée dans la recette) */
  par_defaut: boolean;
  ingredient: Ingredient;
}

export interface Recipe {
  id: number;
  nom: string;
  description: string | null;
  categorie: string | null;
  portions: number | null;
  temps_preparation: number | null;
  /** Validée : visible par tout le monde ; sinon seulement par la personne qui l'a créée */
  valide: boolean;
  /** Utilisateur qui l'a ajoutée au catalogue (0 = inconnu) */
  created_by: number;
  created_by_nom: string | null;
  ingredients: RecipeIngredient[];
}

export type Moment = "matin" | "midi" | "soir" | "snack";

/** Recette préparée : ingrédients réellement utilisés (g / ml) et portions obtenues */
export interface Preparation {
  id: number;
  recipe_id: number;
  portions: number;
  date: string | null;
  /** Différente de la recette d'origine */
  adaptee: boolean;
  ingredients: { ingredient_id: number; quantite: number }[];
}

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
  /** Part d'un plat préparé (null : ancien repas, recette d'origine) */
  preparation_id: number | null;
  preparation: Preparation | null;
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
  /** Recette : le plat du frigo dont on prend une part */
  fridge_item_id?: number | null;
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
  /** Plat cuisiné : ce qui a réellement été préparé */
  preparation: Preparation | null;
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
  /** Nouvelles pesées de la balance */
  weigh_ins?: number;
}

export interface BodyComposition {
  id: number;
  date: string;
  mesure_at: string | null;
  poids_kg: number;
  imc: number | null;
  masse_grasse_pct: number | null;
  masse_musculaire_kg: number | null;
  masse_osseuse_kg: number | null;
  eau_pct: number | null;
  graisse_viscerale: number | null;
  age_metabolique: number | null;
  source: "garmin" | "manuel";
  /** Pesée de la balance corrigée à la main */
  modifie: boolean;
}

export interface FitnessMetric {
  date: string;
  readiness_score: number | null;
  readiness_niveau: string | null;
  readiness_conseil: string | null;
  statut_entrainement: string | null;
  charge_aigue: number | null;
  charge_chronique: number | null;
  vo2max: number | null;
  vo2max_velo: number | null;
  prediction_5k_s: number | null;
  prediction_10k_s: number | null;
  prediction_semi_s: number | null;
  prediction_marathon_s: number | null;
  endurance_score: number | null;
  hill_score: number | null;
  age_forme: number | null;
  synced_at: string | null;
}

export type Recurrence = "daily" | "weekly" | "monthly";
/** Occurrence tranchée ; null = encore à faire. */
export type TaskStatut = "fait" | "pas_fait";

export interface TaskInput {
  titre: string;
  notes: string | null;
  date: string;
  heure: string | null;
  recurrence: Recurrence | null;
  recurrence_fin: string | null;
  important: boolean;
  /** Tâche sportive : validée par une activité de ce type le jour prévu */
  activity_type_id: number | null;
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
  important: boolean;
  activity_type_id: number | null;
  activity_type_nom: string | null;
  /** Ajoutée depuis un bilan du coach */
  par_coach: boolean;
  /** Séance structurée (course) et envoi sur la montre */
  seance: SeanceStep[] | null;
  /** Séance de renforcement : exercices */
  exercices: StrengthExercise[] | null;
  garmin_envoye: boolean;
  /** Faite parce qu'une activité du bon type existe ce jour-là (pas de coche manuelle) */
  auto: boolean;
  activity_id: number | null;
  statut: TaskStatut | null;
  /** statut === "fait" */
  fait: boolean;
  done_at: string | null;
}

export type RegimeAlimentaire = "omnivore" | "flexitarien" | "pescetarien" | "vegetarien" | "vegan";

export interface SeanceSimpleStep {
  type: "echauffement" | "effort" | "recuperation" | "retour_au_calme";
  duree_s: number | null;
  distance_m: number | null;
  zone_fc: number | null;
  allure_s_km: number | null;
}

export type SeanceStep = SeanceSimpleStep | { type: "repetition"; repetitions: number; etapes: SeanceSimpleStep[] };

export interface StrengthExercise {
  exercice: string;
  series: number;
  repetitions: number | null;
  duree_s: number | null;
  charge_kg: number | null;
  repos_s: number;
}

/** Jalon du mois en cours, lu dans le plan, et où on en est (calculé par le serveur). */
export interface PlanMilestone {
  numero: number;
  nombre: number;
  titre: string;
  statut: "en_cours" | "a_venir" | "termine";
  debut: string;
  fin: string;
  jour: number;
  jours: number;
  lignes: string[];
  cibles: {
    km_semaine_min?: number;
    km_semaine_max?: number;
    d_plus_semaine?: number;
    sortie_longue_km?: number;
    sortie_longue_d_plus?: number;
  };
  sport: "pied" | "velo" | "natation";
  /** Sports écrits dans le plan (« Sports comptés »), sinon null et sports_auto décrit ceux pris par défaut */
  sports_comptes: string[] | null;
  sports_auto: string | null;
  semaine: { km: number; d_plus_m: number; seances: number; depuis: string };
  plus_longue_sortie: { km: number; d_plus_m: number; date: string | null };
}
