from pydantic import BaseModel
from datetime import date as date_type


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


# --- Ingredient ---

class IngredientCreate(BaseModel):
    nom: str
    description: str | None = None
    categorie: str | None = None
    calories: float | None = None
    proteines: float | None = None
    glucides: float | None = None
    lipides: float | None = None
    unite: str = "g"
    quantite_defaut: float | None = None

class IngredientRead(IngredientCreate):
    id: int
    nutriments: list[IngredientNutrimentRead] = []

    model_config = {"from_attributes": True}


# --- RecipeIngredient ---

class RecipeIngredientCreate(BaseModel):
    ingredient_id: int
    quantite: float
    type_mesure: str = "poids"

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
    ingredients: list[RecipeIngredientRead] = []

    model_config = {"from_attributes": True}


# --- ActivityType ---

class ActivityTypeCreate(BaseModel):
    nom: str
    description: str | None = None
    met_value: float | None = None

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


# --- User ---

class UserCreate(BaseModel):
    nom: str
    email: str
    password: str
    calories_cible: float | None = None
    proteines_cible: float | None = None
    glucides_cible: float | None = None
    lipides_cible: float | None = None

class UserUpdate(BaseModel):
    nom: str | None = None
    calories_cible: float | None = None
    proteines_cible: float | None = None
    glucides_cible: float | None = None
    lipides_cible: float | None = None

class UserRead(BaseModel):
    id: int
    nom: str
    email: str
    calories_cible: float | None = None
    proteines_cible: float | None = None
    glucides_cible: float | None = None
    lipides_cible: float | None = None
    garmin_connected: bool = False

    model_config = {"from_attributes": True}

class UserLogin(BaseModel):
    email: str
    password: str

class ChangePassword(BaseModel):
    old_password: str
    new_password: str


# --- MealLog ---

class MealLogCreate(BaseModel):
    date: date_type
    moment: str
    recipe_id: int | None = None
    ingredient_id: int | None = None
    quantite: float | None = None
    type_mesure: str = "poids"
    notes: str | None = None

class MealLogRead(MealLogCreate):
    id: int
    user_id: int

    model_config = {"from_attributes": True}
