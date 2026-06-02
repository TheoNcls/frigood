from sqlalchemy import Column, Integer, String, Float, ForeignKey, Date
from sqlalchemy.orm import relationship
from app.database import Base


class Ingredient(Base):
    __tablename__ = "ingredients"

    id = Column(Integer, primary_key=True)
    nom = Column(String, nullable=False, unique=True)
    description = Column(String, nullable=True)
    calories = Column(Float, nullable=True)
    proteines = Column(Float, nullable=True)
    glucides = Column(Float, nullable=True)
    lipides = Column(Float, nullable=True)
    unite = Column(String, default="g")
    quantite_defaut = Column(Float, nullable=True)

    recettes = relationship("RecipeIngredient", back_populates="ingredient")
    nutriments = relationship("IngredientNutriment", back_populates="ingredient", cascade="all, delete-orphan")


class Nutriment(Base):
    __tablename__ = "nutriments"

    id = Column(Integer, primary_key=True)
    nom = Column(String, nullable=False, unique=True)
    unite = Column(String, nullable=False, default="g")

    ingredients = relationship("IngredientNutriment", back_populates="nutriment")


class IngredientNutriment(Base):
    __tablename__ = "ingredient_nutriments"

    id = Column(Integer, primary_key=True)
    ingredient_id = Column(Integer, ForeignKey("ingredients.id"), nullable=False)
    nutriment_id = Column(Integer, ForeignKey("nutriments.id"), nullable=False)
    valeur = Column(Float, nullable=False)
    notes = Column(String, nullable=True)

    ingredient = relationship("Ingredient", back_populates="nutriments")
    nutriment = relationship("Nutriment", back_populates="ingredients")


class Recipe(Base):
    __tablename__ = "recipes"

    id = Column(Integer, primary_key=True)
    nom = Column(String, nullable=False, unique=True)
    description = Column(String, nullable=True)

    ingredients = relationship("RecipeIngredient", back_populates="recette")


class RecipeIngredient(Base):
    __tablename__ = "recipe_ingredients"

    id = Column(Integer, primary_key=True)
    recipe_id = Column(Integer, ForeignKey("recipes.id"), nullable=False)
    ingredient_id = Column(Integer, ForeignKey("ingredients.id"), nullable=False)
    quantite = Column(Float, nullable=False)
    type_mesure = Column(String, nullable=False, default="poids")

    recette = relationship("Recipe", back_populates="ingredients")
    ingredient = relationship("Ingredient", back_populates="recettes")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    nom = Column(String, nullable=False)
    email = Column(String, nullable=False, unique=True)
    password_hash = Column(String, nullable=False)
    calories_cible = Column(Float, nullable=True)
    proteines_cible = Column(Float, nullable=True)
    glucides_cible = Column(Float, nullable=True)
    lipides_cible = Column(Float, nullable=True)

    meal_logs = relationship("MealLog", back_populates="user", cascade="all, delete-orphan")


class MealLog(Base):
    __tablename__ = "meal_logs"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    date = Column(Date, nullable=False)
    moment = Column(String, nullable=False)
    recipe_id = Column(Integer, ForeignKey("recipes.id"), nullable=True)
    ingredient_id = Column(Integer, ForeignKey("ingredients.id"), nullable=True)
    quantite = Column(Float, nullable=True)
    type_mesure = Column(String, nullable=True, default="poids")
    notes = Column(String, nullable=True)

    user = relationship("User", back_populates="meal_logs")
    recipe = relationship("Recipe")
    ingredient = relationship("Ingredient")
