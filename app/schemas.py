from pydantic import BaseModel


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
