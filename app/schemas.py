import json
from typing import Literal
from pydantic import BaseModel, field_validator, model_validator
from datetime import date as date_type, datetime as datetime_type


# --- Nutriment ---

class NutrimentCreate(BaseModel):
    nom: str
    unite: str = "g"

class NutrimentRead(NutrimentCreate):
    id: int

    model_config = {"from_attributes": True}


# --- IngredientNutriment ---

class IngredientNutrimentCreate(BaseModel):
    nutriment_id: int
    valeur: float
    notes: str | None = None

class IngredientNutrimentRead(IngredientNutrimentCreate):
    id: int
    nutriment: NutrimentRead

    model_config = {"from_attributes": True}


# --- IngredientSource ---

class IngredientSourceRead(BaseModel):
    id: int
    ingredient_id: int
    source_type: str
    code_barre: str | None = None
    created_at: datetime_type | None = None

    model_config = {"from_attributes": True}


# --- Ingredient ---

REGIMES = ("vegan", "vegetarien", "non_vegetarien", "incertain")
GREENSCORES = ("a-plus", "a", "b", "c", "d", "e", "f")

class IngredientBase(BaseModel):
    nom: str
    description: str | None = None
    categorie: str | None = None
    calories: float | None = None
    proteines: float | None = None
    glucides: float | None = None
    lipides: float | None = None
    unite: str = "g"
    quantite_defaut: float | None = None
    duree_conservation: int | None = 7
    nutriscore: str | None = None
    greenscore: str | None = None
    nova: int | None = None
    regime: str | None = None
    image_url: str | None = None
    composition: str | None = None

    @field_validator("composition")
    @classmethod
    def _check_composition(cls, v: str | None) -> str | None:
        v = (v or "").strip()
        return v[:5000] or None

    @field_validator("image_url")
    @classmethod
    def _check_image_url(cls, v: str | None) -> str | None:
        # Uniquement des liens https : un lien "javascript:" ou "data:" ne doit jamais atteindre une balise <img>
        v = (v or "").strip()
        return v if v.startswith("https://") and len(v) <= 2000 else None

    @field_validator("greenscore")
    @classmethod
    def _check_greenscore(cls, v: str | None) -> str | None:
        v = (v or "").strip().lower().replace("+", "-plus")
        return v if v in GREENSCORES else None

    @field_validator("nutriscore")
    @classmethod
    def _check_nutriscore(cls, v: str | None) -> str | None:
        v = (v or "").strip().lower()
        return v if v in ("a", "b", "c", "d", "e") else None

    @field_validator("nova")
    @classmethod
    def _check_nova(cls, v: int | None) -> int | None:
        return v if v in (1, 2, 3, 4) else None

    @field_validator("regime")
    @classmethod
    def _check_regime(cls, v: str | None) -> str | None:
        v = (v or "").strip().lower()
        return v if v in REGIMES else None

    @model_validator(mode="after")
    def _normalize_unit(self):
        # Les valeurs sont pour 100 g ou 100 ml et les calculs lisent la quantité comme des g / ml :
        # toute autre unité fausserait les calories (25 cl compteraient pour 25 ml)
        unit = (self.unite or "g").strip().lower()
        factor = {"cl": 10, "l": 1000, "kg": 1000}.get(unit)
        if factor:
            unit = "g" if unit == "kg" else "ml"
            if self.quantite_defaut:
                self.quantite_defaut = round(self.quantite_defaut * factor, 2)
        self.unite = unit
        return self

class IngredientCreate(IngredientBase):
    # Champs optionnels pour traçabilité source (non stockés sur Ingredient)
    source_type: str | None = None
    source_code_barre: str | None = None
    source_raw_data: str | None = None

class IngredientRead(IngredientBase):
    id: int
    created_by: int = 0
    created_by_nom: str | None = None
    nutriments: list[IngredientNutrimentRead] = []
    sources: list[IngredientSourceRead] = []

    model_config = {"from_attributes": True}


# --- RecipeIngredient ---

class RecipeIngredientCreate(BaseModel):
    ingredient_id: int
    quantite: float
    type_mesure: str = "poids"
    # Décoché : une option, proposée à la préparation sans être comptée dans la recette
    par_defaut: bool = True

class RecipeIngredientUpdate(BaseModel):
    quantite: float | None = None
    type_mesure: str | None = None
    par_defaut: bool | None = None

class RecipeIngredientRead(RecipeIngredientCreate):
    id: int
    ingredient: IngredientRead

    model_config = {"from_attributes": True}


# --- Recipe ---

class RecipeCreate(BaseModel):
    nom: str
    description: str | None = None
    categorie: str | None = None
    portions: int | None = 1
    temps_preparation: int | None = None

class RecipeRead(RecipeCreate):
    id: int
    created_by: int = 0
    created_by_nom: str | None = None
    ingredients: list[RecipeIngredientRead] = []

    model_config = {"from_attributes": True}


# --- ActivityType ---

class ActivityTypeCreate(BaseModel):
    nom: str
    description: str | None = None
    met_value: float | None = None
    garmin_type_key: str | None = None

    @field_validator("garmin_type_key")
    @classmethod
    def _normalize_key(cls, v: str | None) -> str | None:
        v = (v or "").strip().lower()
        return v or None

class ActivityTypeRead(ActivityTypeCreate):
    id: int
    model_config = {"from_attributes": True}


# --- Activity ---

class ActivityCreate(BaseModel):
    date: date_type
    activity_type_id: int | None = None
    source: str = "manual"
    garmin_activity_id: str | None = None
    duree_min: int | None = None
    calories: float | None = None
    distance_km: float | None = None
    freq_cardiaque_moy: int | None = None
    notes: str | None = None

class ActivityRead(ActivityCreate):
    id: int
    user_id: int
    activity_type: ActivityTypeRead | None = None
    model_config = {"from_attributes": True}


# --- DailyStat ---

class DailyStatRead(BaseModel):
    id: int
    user_id: int
    date: date_type
    sommeil_total_h: float | None = None
    sommeil_profond_h: float | None = None
    sommeil_leger_h: float | None = None
    sommeil_rem_h: float | None = None
    sommeil_eveil_h: float | None = None
    sommeil_score: int | None = None
    heure_coucher: str | None = None
    heure_reveil: str | None = None
    bpm_repos: int | None = None
    bpm_moy: int | None = None
    bpm_min: int | None = None
    bpm_max: int | None = None
    stress_moy: int | None = None
    stress_max: int | None = None
    body_battery_max: int | None = None
    body_battery_min: int | None = None
    steps: int | None = None
    steps_goal: int | None = None
    etages: int | None = None
    respiration_moy: float | None = None
    spo2_moy: int | None = None
    hrv_moy: int | None = None
    model_config = {"from_attributes": True}


# --- GarminCredentials ---

class GarminCredentials(BaseModel):
    email: str | None = None
    password: str | None = None
    mfa_code: str | None = None


class GarminTokens(BaseModel):
    tokens: str


# --- User ---

class UserCreate(BaseModel):
    nom: str
    email: str
    password: str
    calories_cible: float | None = None
    proteines_cible: float | None = None
    glucides_cible: float | None = None
    lipides_cible: float | None = None

PROFIL_COACHING_MAX = 4000
REGIMES_ALIMENTAIRES = ("omnivore", "flexitarien", "pescetarien", "vegetarien", "vegan")


class UserUpdate(BaseModel):
    nom: str | None = None
    calories_cible: float | None = None
    proteines_cible: float | None = None
    glucides_cible: float | None = None
    lipides_cible: float | None = None
    # Envoyé à null pour revenir à un objectif fixe en grammes
    proteines_g_kg: float | None = None
    # Envoyés à null (ou vides) pour effacer
    date_naissance: date_type | None = None
    profil_coaching: str | None = None
    regime_alimentaire: str | None = None
    # Envoyé à null pour revenir à « pas renseigné » (tous les exercices)
    materiel: list[str] | None = None

    @field_validator("materiel")
    @classmethod
    def _check_materiel(cls, v: list[str] | None) -> list[str] | None:
        from app.garmin_workouts import EQUIPMENT
        if v is None:
            return None
        unknown = [m for m in v if m not in EQUIPMENT]
        if unknown:
            raise ValueError(f"Matériel inconnu : {', '.join(unknown)}")
        return sorted(set(v))

    @field_validator("regime_alimentaire")
    @classmethod
    def _check_regime(cls, v: str | None) -> str | None:
        if v is not None and v not in REGIMES_ALIMENTAIRES:
            raise ValueError("Régime alimentaire inconnu")
        return v

    @field_validator("date_naissance")
    @classmethod
    def _check_naissance(cls, v: date_type | None) -> date_type | None:
        if v is not None and not (date_type(1900, 1, 1) <= v <= date_type.today()):
            raise ValueError("Date de naissance invalide")
        return v

    @field_validator("profil_coaching")
    @classmethod
    def _check_coaching(cls, v: str | None) -> str | None:
        v = (v or "").strip()
        if len(v) > PROFIL_COACHING_MAX:
            raise ValueError(f"Texte trop long ({PROFIL_COACHING_MAX} caractères maximum)")
        return v or None

    @field_validator("proteines_g_kg")
    @classmethod
    def _check_g_kg(cls, v: float | None) -> float | None:
        if v is None or v <= 0:
            return None
        if v > 4:
            raise ValueError("Objectif protéines trop élevé (4 g/kg maximum)")
        return round(v, 2)

class UserRead(BaseModel):
    id: int
    nom: str
    email: str
    calories_cible: float | None = None
    proteines_cible: float | None = None
    glucides_cible: float | None = None
    lipides_cible: float | None = None
    proteines_g_kg: float | None = None
    date_naissance: date_type | None = None
    profil_coaching: str | None = None
    regime_alimentaire: str = "vegetarien"
    materiel: list[str] | None = None
    zones_fc: dict | None = None
    garmin_connected: bool = False
    garmin_auto_sync: bool = True
    garmin_last_sync_at: datetime_type | None = None
    garmin_last_sync_auto: bool | None = None
    garmin_last_sync_activities: int | None = None
    garmin_last_sync_days: int | None = None
    is_admin: bool = False
    coach_autorise: bool = False
    coach_access: bool = False

    model_config = {"from_attributes": True}

class GarminAutoSettings(BaseModel):
    enabled: bool

class UserWithToken(UserRead):
    access_token: str
    token_type: str = "bearer"

class UserLogin(BaseModel):
    email: str
    password: str

class ChangePassword(BaseModel):
    old_password: str
    new_password: str


# --- Plat préparé ---

class PreparationIngredientIn(BaseModel):
    ingredient_id: int
    quantite: float  # g / ml

class PreparationIngredientRead(PreparationIngredientIn):
    model_config = {"from_attributes": True}

class PreparationRead(BaseModel):
    id: int
    recipe_id: int
    portions: float
    date: date_type | None = None
    adaptee: bool = False
    ingredients: list[PreparationIngredientRead] = []

    model_config = {"from_attributes": True}


# --- MealLog ---

class MealLogCreate(BaseModel):
    date: date_type
    moment: str
    recipe_id: int | None = None
    ingredient_id: int | None = None
    quantite: float | None = None
    type_mesure: str = "poids"
    notes: str | None = None
    # Recette : le plat du frigo dont on prend une part (sinon celui de cette recette qui périme le plus tôt)
    fridge_item_id: int | None = None

class MealLogRead(BaseModel):
    id: int
    user_id: int
    date: date_type
    moment: str
    recipe_id: int | None = None
    ingredient_id: int | None = None
    quantite: float | None = None
    type_mesure: str = "poids"
    notes: str | None = None
    preparation_id: int | None = None
    preparation: PreparationRead | None = None
    fridge_updates: list[str] = []

    model_config = {"from_attributes": True}


# --- Frigo ---

class FridgeItemCreate(BaseModel):
    ingredient_id: int | None = None
    recipe_id: int | None = None
    quantite: float
    date_achat: date_type | None = None
    date_peremption: date_type | None = None
    deduire_ingredients: bool = False
    # Plat cuisiné : ingrédients réellement utilisés pour toute la préparation (g / ml).
    # Absent : la recette d'origine, à l'échelle du nombre de portions
    ingredients: list[PreparationIngredientIn] | None = None

class FridgeItemUpdate(BaseModel):
    quantite: float | None = None
    date_achat: date_type | None = None
    date_peremption: date_type | None = None

class FridgeItemRead(BaseModel):
    id: int
    user_id: int
    ingredient_id: int | None = None
    recipe_id: int | None = None
    quantite: float
    date_achat: date_type | None = None
    date_peremption: date_type | None = None
    created_at: datetime_type | None = None
    preparation: PreparationRead | None = None

    model_config = {"from_attributes": True}

class FridgeHistoryRead(BaseModel):
    id: int
    ingredient_id: int | None = None
    recipe_id: int | None = None
    quantite: float
    action: str
    meal_log_id: int | None = None
    date_achat: date_type | None = None
    date_peremption: date_type | None = None
    notes: str | None = None
    created_at: datetime_type | None = None

    model_config = {"from_attributes": True}


# --- Tâches ---

RECURRENCES = ("daily", "weekly", "monthly")


class TaskBase(BaseModel):
    titre: str
    notes: str | None = None
    date: date_type
    heure: str | None = None
    recurrence: str | None = None
    recurrence_fin: date_type | None = None
    important: bool = False
    activity_type_id: int | None = None

    @field_validator("titre")
    @classmethod
    def _check_titre(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Le titre est obligatoire")
        return v[:200]

    @field_validator("heure")
    @classmethod
    def _check_heure(cls, v: str | None) -> str | None:
        v = (v or "").strip()
        if not v:
            return None
        hh, _, mm = v.partition(":")
        if not (hh.isdigit() and mm.isdigit() and 0 <= int(hh) < 24 and 0 <= int(mm) < 60):
            raise ValueError("Heure invalide (format HH:MM)")
        return f"{int(hh):02d}:{int(mm):02d}"

    @field_validator("recurrence")
    @classmethod
    def _check_recurrence(cls, v: str | None) -> str | None:
        v = (v or "").strip().lower()
        return v if v in RECURRENCES else None

    @model_validator(mode="after")
    def _check_fin(self):
        if self.recurrence is None or (self.recurrence_fin and self.recurrence_fin < self.date):
            self.recurrence_fin = None
        return self


class TaskCreate(TaskBase):
    pass


class TaskRead(TaskBase):
    id: int
    par_coach: bool = False
    model_config = {"from_attributes": True}


class TaskOccurrence(BaseModel):
    """Une tâche à une date donnée : les tâches récurrentes ont une occurrence par jour concerné."""
    task_id: int
    date: date_type
    titre: str
    notes: str | None = None
    heure: str | None = None
    recurrence: str | None = None
    recurrence_fin: date_type | None = None
    serie_debut: date_type
    important: bool = False
    activity_type_id: int | None = None
    activity_type_nom: str | None = None
    par_coach: bool = False
    seance: list | None = None
    exercices: list | None = None
    garmin_envoye: bool = False
    # Validée par une activité du bon type ce jour-là (sans coche manuelle)
    auto: bool = False
    activity_id: int | None = None
    statut: Literal["fait", "pas_fait"] | None = None
    fait: bool
    done_at: datetime_type | None = None


class TaskDone(BaseModel):
    """statut : "fait", "pas_fait", ou null pour remettre « à faire ». `fait` (booléen) reste accepté."""
    date: date_type
    statut: Literal["fait", "pas_fait"] | None = "fait"

    @model_validator(mode="before")
    @classmethod
    def _from_fait(cls, data):
        if isinstance(data, dict) and "statut" not in data and "fait" in data:
            return {**data, "statut": "fait" if data["fait"] else None}
        return data


# --- Notifications ---

class PushKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscriptionIn(BaseModel):
    endpoint: str
    keys: PushKeys


# --- Corps & forme ---

class BodyCompositionCreate(BaseModel):
    """Pesée saisie à la main (sans balance connectée)."""
    date: date_type
    poids_kg: float
    masse_grasse_pct: float | None = None
    masse_musculaire_kg: float | None = None

    @field_validator("poids_kg")
    @classmethod
    def _check_poids(cls, v: float) -> float:
        if not 20 <= v <= 400:
            raise ValueError("Poids invalide")
        return round(v, 2)

    @field_validator("masse_grasse_pct")
    @classmethod
    def _check_mg(cls, v: float | None) -> float | None:
        if v is not None and not 1 <= v <= 75:
            raise ValueError("Masse grasse invalide")
        return v


class BodyCompositionUpdate(BaseModel):
    """Correction d'une pesée : poids et masse grasse."""
    poids_kg: float
    masse_grasse_pct: float | None = None

    _check_poids = field_validator("poids_kg")(BodyCompositionCreate._check_poids.__func__)
    _check_mg = field_validator("masse_grasse_pct")(BodyCompositionCreate._check_mg.__func__)


class BodyCompositionRead(BaseModel):
    id: int
    date: date_type
    mesure_at: datetime_type | None = None
    poids_kg: float
    imc: float | None = None
    masse_grasse_pct: float | None = None
    masse_musculaire_kg: float | None = None
    masse_osseuse_kg: float | None = None
    eau_pct: float | None = None
    graisse_viscerale: float | None = None
    age_metabolique: int | None = None
    source: str
    modifie: bool = False

    model_config = {"from_attributes": True}


class FitnessMetricRead(BaseModel):
    date: date_type
    readiness_score: int | None = None
    readiness_niveau: str | None = None
    readiness_conseil: str | None = None
    statut_entrainement: str | None = None
    charge_aigue: int | None = None
    charge_chronique: int | None = None
    vo2max: float | None = None
    vo2max_velo: float | None = None
    prediction_5k_s: int | None = None
    prediction_10k_s: int | None = None
    prediction_semi_s: int | None = None
    prediction_marathon_s: int | None = None
    endurance_score: int | None = None
    hill_score: int | None = None
    age_forme: float | None = None
    synced_at: datetime_type | None = None

    model_config = {"from_attributes": True}


class CoachReportRead(BaseModel):
    id: int
    created_at: datetime_type
    texte: str
    model: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    donnees: dict | None = None
    activites_ajoutees_at: datetime_type | None = None
    semaine_cible: date_type | None = None

    @field_validator("donnees", mode="before")
    @classmethod
    def _parse_donnees(cls, v):
        if isinstance(v, str):
            try:
                return json.loads(v)
            except ValueError:
                return None
        return v

    model_config = {"from_attributes": True}


class CoachActivitiesAdd(BaseModel):
    """Index des activités du bilan à ajouter à l'agenda (toutes si absent)."""
    indexes: list[int] | None = None


# --- Administration des comptes ---

class AdminUserRead(BaseModel):
    id: int
    nom: str
    email: str
    is_admin: bool = False
    coach_autorise: bool = False
    coach_access: bool = False
    garmin_connected: bool = False
    garmin_last_sync_at: datetime_type | None = None
    bilans_coach: int = 0
    dernier_bilan_at: datetime_type | None = None

    model_config = {"from_attributes": True}

class AdminUserUpdate(BaseModel):
    coach_autorise: bool | None = None
