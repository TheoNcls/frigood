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

class IngredientNutrimentRead(IngredientNutrimentCreate):
    id: int
    nutriment: NutrimentRead

    model_config = {"from_attributes": True}


# --- Ingredient ---

class IngredientCreate(BaseModel):
    nom: str
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

class RecipeRead(RecipeCreate):
    id: int
    ingredients: list[RecipeIngredientRead] = []

    model_config = {"from_attributes": True}


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
