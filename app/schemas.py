from pydantic import BaseModel


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
