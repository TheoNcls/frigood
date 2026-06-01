from sqlalchemy import Column, Integer, String, Float, ForeignKey
from sqlalchemy.orm import relationship
from app.database import Base


class Ingredient(Base):
    __tablename__ = "ingredients"

    id = Column(Integer, primary_key=True)
    nom = Column(String, nullable=False, unique=True)
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
