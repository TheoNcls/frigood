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
    nova: int | None = None
    regime: str | None = None

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
    nutriments: list[IngredientNutrimentRead] = []
    sources: list[IngredientSourceRead] = []

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
    is_admin: bool = False

    model_config = {"from_attributes": True}

class UserWithToken(UserRead):
    access_token: str
    token_type: str = "bearer"

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
