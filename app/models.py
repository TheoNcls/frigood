import os
from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, ForeignKey, Date, DateTime, Text
from sqlalchemy.orm import deferred, relationship
from app.database import Base


class Ingredient(Base):
    __tablename__ = "ingredients"

    id = Column(Integer, primary_key=True)
    nom = Column(String, nullable=False, unique=True)
    description = Column(String, nullable=True)
    categorie = Column(String, nullable=True)
    calories = Column(Float, nullable=True)
    proteines = Column(Float, nullable=True)
    glucides = Column(Float, nullable=True)
    lipides = Column(Float, nullable=True)
    unite = Column(String, default="g")
    quantite_defaut = Column(Float, nullable=True)
    duree_conservation = Column(Integer, nullable=True, default=7, server_default="7")

    recettes = relationship("RecipeIngredient", back_populates="ingredient")
    nutriments = relationship("IngredientNutriment", back_populates="ingredient", cascade="all, delete-orphan")
    sources = relationship("IngredientSource", back_populates="ingredient", cascade="all, delete-orphan")


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
    categorie = Column(String, nullable=True)
    portions = Column(Integer, nullable=True, default=1)
    temps_preparation = Column(Integer, nullable=True)

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


class ActivityType(Base):
    __tablename__ = "activity_types"

    id = Column(Integer, primary_key=True)
    nom = Column(String, nullable=False, unique=True)
    description = Column(String, nullable=True)
    met_value = Column(Float, nullable=True)
    # Clé Garmin ("running", "cycling"…) pour rattacher automatiquement les activités synchronisées
    garmin_type_key = Column(String(80), nullable=True, unique=True)

    activities = relationship("Activity", back_populates="activity_type")


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

    garmin_tokens = Column(String, nullable=True)

    meal_logs = relationship("MealLog", back_populates="user", cascade="all, delete-orphan")
    activities = relationship("Activity", back_populates="user", cascade="all, delete-orphan")
    daily_stats = relationship("DailyStat", back_populates="user", cascade="all, delete-orphan")
    fridge_items = relationship("FridgeItem", cascade="all, delete-orphan")
    fridge_history = relationship("FridgeHistory", cascade="all, delete-orphan")

    @property
    def garmin_connected(self) -> bool:
        return self.garmin_tokens is not None

    @property
    def is_admin(self) -> bool:
        admins = {e.strip().lower() for e in os.getenv("ADMIN_EMAILS", "").split(",") if e.strip()}
        return (self.email or "").lower() in admins


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


class Activity(Base):
    __tablename__ = "activities"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    date = Column(Date, nullable=False)
    activity_type_id = Column(Integer, ForeignKey("activity_types.id"), nullable=True)
    source = Column(String, nullable=False, default="manual")
    garmin_activity_id = Column(String, nullable=True, unique=True)
    duree_min = Column(Integer, nullable=True)
    calories = Column(Float, nullable=True)
    distance_km = Column(Float, nullable=True)
    freq_cardiaque_moy = Column(Integer, nullable=True)
    notes = Column(String, nullable=True)
    # JSON brut Garmin, chargé seulement à la demande (volumineux)
    raw_data = deferred(Column(Text, nullable=True))

    user = relationship("User", back_populates="activities")
    activity_type = relationship("ActivityType", back_populates="activities")


class DailyStat(Base):
    __tablename__ = "daily_stats"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    date = Column(Date, nullable=False)

    # Sommeil
    sommeil_total_h = Column(Float, nullable=True)
    sommeil_profond_h = Column(Float, nullable=True)
    sommeil_leger_h = Column(Float, nullable=True)
    sommeil_rem_h = Column(Float, nullable=True)
    sommeil_eveil_h = Column(Float, nullable=True)
    sommeil_score = Column(Integer, nullable=True)
    heure_coucher = Column(String, nullable=True)
    heure_reveil = Column(String, nullable=True)

    # Cœur
    bpm_repos = Column(Integer, nullable=True)
    bpm_moy = Column(Integer, nullable=True)
    bpm_min = Column(Integer, nullable=True)
    bpm_max = Column(Integer, nullable=True)

    # Stress
    stress_moy = Column(Integer, nullable=True)
    stress_max = Column(Integer, nullable=True)

    # Énergie
    body_battery_max = Column(Integer, nullable=True)
    body_battery_min = Column(Integer, nullable=True)

    # Activité physique
    steps = Column(Integer, nullable=True)
    steps_goal = Column(Integer, nullable=True)
    etages = Column(Integer, nullable=True)

    # Respiration
    respiration_moy = Column(Float, nullable=True)

    # SpO2
    spo2_moy = Column(Integer, nullable=True)

    # HRV
    hrv_moy = Column(Integer, nullable=True)

    # Réponses Garmin brutes de la journée (stats, sommeil, body battery…), chargées seulement à la demande
    raw_data = deferred(Column(Text, nullable=True))
    # Une journée est complète si elle a été synchronisée après sa fin
    synced_at = Column(DateTime, nullable=True)

    user = relationship("User", back_populates="daily_stats")


class IngredientSource(Base):
    __tablename__ = "ingredient_sources"

    id = Column(Integer, primary_key=True)
    ingredient_id = Column(Integer, ForeignKey("ingredients.id", ondelete="CASCADE"), nullable=False)
    source_type = Column(String(50), nullable=False)  # 'openfoodfacts', 'claude', 'manual'
    code_barre = Column(String(50), nullable=True)
    raw_data = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    ingredient = relationship("Ingredient", back_populates="sources")


class FridgeItem(Base):
    __tablename__ = "fridge_items"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    ingredient_id = Column(Integer, ForeignKey("ingredients.id", ondelete="CASCADE"), nullable=True)
    recipe_id = Column(Integer, ForeignKey("recipes.id", ondelete="CASCADE"), nullable=True)
    # Unité de base de l'ingrédient (g/cl) ou nombre de portions pour une recette
    quantite = Column(Float, nullable=False)
    date_achat = Column(Date, nullable=True)
    date_peremption = Column(Date, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class FridgeHistory(Base):
    __tablename__ = "fridge_history"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    ingredient_id = Column(Integer, ForeignKey("ingredients.id", ondelete="SET NULL"), nullable=True)
    recipe_id = Column(Integer, ForeignKey("recipes.id", ondelete="SET NULL"), nullable=True)
    quantite = Column(Float, nullable=False)  # positif = ajout, négatif = retrait
    action = Column(String(30), nullable=False)  # ajout, repas, cuisine, modification, suppression, perime
    meal_log_id = Column(Integer, ForeignKey("meal_logs.id", ondelete="SET NULL"), nullable=True)
    # Pas de clé étrangère : la ligne d'historique survit à la suppression de l'élément du frigo
    fridge_item_id = Column(Integer, nullable=True, index=True)
    date_achat = Column(Date, nullable=True)
    date_peremption = Column(Date, nullable=True)
    notes = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
