import os
from datetime import datetime
from sqlalchemy import false, Boolean, Column, Integer, String, Float, ForeignKey, Date, DateTime, Text, UniqueConstraint
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
    nutriscore = Column(String(1), nullable=True)   # a à e
    greenscore = Column(String(6), nullable=True)   # a-plus, a à f (impact environnemental)
    nova = Column(Integer, nullable=True)           # 1 (brut) à 4 (ultra-transformé)
    regime = Column(String(20), nullable=True)      # vegan, vegetarien, non_vegetarien, incertain
    image_url = Column(String, nullable=True)       # vignette (lien OpenFoodFacts, non copiée chez nous)
    composition = Column(Text, nullable=True)       # liste des ingrédients d'un produit transformé
    # Qui l'a ajouté au catalogue : id de l'utilisateur, 0 = inconnu (avant ce suivi, script, clé API)
    created_by = Column(Integer, nullable=False, default=0, server_default="0")

    recettes = relationship("RecipeIngredient", back_populates="ingredient")
    nutriments = relationship("IngredientNutriment", back_populates="ingredient", cascade="all, delete-orphan")
    sources = relationship("IngredientSource", back_populates="ingredient", cascade="all, delete-orphan")
    # Pas de clé étrangère (0 n'est pas un utilisateur, et un compte supprimé ne doit pas effacer ses ingrédients)
    creator = relationship("User", primaryjoin="foreign(Ingredient.created_by) == User.id", viewonly=True, lazy="joined")

    @property
    def created_by_nom(self) -> str | None:
        return self.creator.nom if self.creator else None


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
    # Qui l'a ajoutée au catalogue : id de l'utilisateur, 0 = inconnu (avant ce suivi, script, clé API)
    created_by = Column(Integer, nullable=False, default=0, server_default="0")

    ingredients = relationship("RecipeIngredient", back_populates="recette")
    # Pas de clé étrangère, comme pour les ingrédients
    creator = relationship("User", primaryjoin="foreign(Recipe.created_by) == User.id", viewonly=True, lazy="joined")

    @property
    def created_by_nom(self) -> str | None:
        return self.creator.nom if self.creator else None


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
    # Objectif protéines en g par kg de poids : proteines_cible est recalculé à chaque nouvelle pesée
    proteines_g_kg = Column(Float, nullable=True)

    garmin_tokens = Column(String, nullable=True)
    # Synchro automatique du matin (opt-in) : heure locale, et suivi du jour en cours
    garmin_auto_sync = Column(Boolean, nullable=False, default=False, server_default=false())
    garmin_auto_heure = Column(String(5), nullable=False, default="07:00", server_default="07:00")
    garmin_auto_date = Column(Date, nullable=True)          # dernier jour traité (réussi ou abandonné)
    garmin_auto_tries = Column(Integer, nullable=False, default=0, server_default="0")
    garmin_auto_next_at = Column(DateTime, nullable=True)   # prochain essai après un échec (heure locale)
    garmin_auto_status = Column(String(300), nullable=True)
    garmin_auto_last_at = Column(DateTime, nullable=True)   # dernière synchro automatique réussie (UTC)
    # Dernière synchro réussie, manuelle ou automatique : ce qu'elle a rapporté
    garmin_last_sync_at = Column(DateTime, nullable=True)   # UTC
    garmin_last_sync_auto = Column(Boolean, nullable=True)
    garmin_last_sync_activities = Column(Integer, nullable=True)
    garmin_last_sync_days = Column(Integer, nullable=True)

    meal_logs = relationship("MealLog", back_populates="user", cascade="all, delete-orphan")
    activities = relationship("Activity", back_populates="user", cascade="all, delete-orphan")
    daily_stats = relationship("DailyStat", back_populates="user", cascade="all, delete-orphan")
    fridge_items = relationship("FridgeItem", cascade="all, delete-orphan")
    fridge_history = relationship("FridgeHistory", cascade="all, delete-orphan")
    tasks = relationship("Task", cascade="all, delete-orphan")
    push_subscriptions = relationship("PushSubscription", cascade="all, delete-orphan")
    body_compositions = relationship("BodyComposition", cascade="all, delete-orphan")
    fitness_metrics = relationship("FitnessMetric", cascade="all, delete-orphan")

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


class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    titre = Column(String(200), nullable=False)
    notes = Column(String, nullable=True)
    date = Column(Date, nullable=False)                 # date de la tâche, ou première occurrence si récurrente
    heure = Column(String(5), nullable=True)            # "HH:MM", facultative
    recurrence = Column(String(10), nullable=True)      # None, daily, weekly, monthly
    recurrence_fin = Column(Date, nullable=True)        # dernière occurrence possible, facultative
    # Importante : reste plus longtemps « en retard » sur l'accueil et envoie des rappels
    important = Column(Boolean, nullable=False, default=False, server_default=false())
    # Tâche sportive : validée automatiquement par une activité de ce type le jour prévu (Garmin ou manuelle)
    activity_type_id = Column(Integer, ForeignKey("activity_types.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    completions = relationship("TaskCompletion", cascade="all, delete-orphan", back_populates="task")
    reminders = relationship("TaskReminder", cascade="all, delete-orphan")
    activity_type = relationship("ActivityType")


class TaskCompletion(Base):
    """Une occurrence tranchée (faite ou pas faite) : sert aussi d'historique. Sans ligne : à faire."""
    __tablename__ = "task_completions"
    __table_args__ = (UniqueConstraint("task_id", "date", name="uq_task_completion_day"),)

    id = Column(Integer, primary_key=True)
    task_id = Column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    date = Column(Date, nullable=False)
    statut = Column(String(10), nullable=False, default="fait", server_default="fait")  # fait, pas_fait
    done_at = Column(DateTime, default=datetime.utcnow)

    task = relationship("Task", back_populates="completions")


class TaskReminder(Base):
    """Rappel déjà envoyé pour une occurrence (j3, j1, j0) : jamais deux fois le même."""
    __tablename__ = "task_reminders"
    __table_args__ = (UniqueConstraint("task_id", "date", "kind", name="uq_task_reminder"),)

    id = Column(Integer, primary_key=True)
    task_id = Column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False, index=True)
    date = Column(Date, nullable=False)
    kind = Column(String(4), nullable=False)
    sent_at = Column(DateTime, default=datetime.utcnow)


class PushSubscription(Base):
    """Un appareil (navigateur / app de l'écran d'accueil) qui accepte les notifications."""
    __tablename__ = "push_subscriptions"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    endpoint = Column(Text, nullable=False, unique=True)
    p256dh = Column(String(200), nullable=False)
    auth = Column(String(100), nullable=False)
    user_agent = Column(String(300), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class BodyComposition(Base):
    """Une pesée : balance connectée Garmin ou saisie à la main (sans balance)."""
    __tablename__ = "body_compositions"
    __table_args__ = (UniqueConstraint("user_id", "garmin_sample_pk", name="uq_body_comp_sample"),)

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    date = Column(Date, nullable=False, index=True)
    mesure_at = Column(DateTime, nullable=True)            # UTC, si l'heure est connue
    poids_kg = Column(Float, nullable=False)
    imc = Column(Float, nullable=True)
    masse_grasse_pct = Column(Float, nullable=True)
    masse_musculaire_kg = Column(Float, nullable=True)
    masse_osseuse_kg = Column(Float, nullable=True)
    eau_pct = Column(Float, nullable=True)
    graisse_viscerale = Column(Float, nullable=True)
    age_metabolique = Column(Integer, nullable=True)
    source = Column(String(10), nullable=False, default="garmin")   # garmin, manuel
    garmin_sample_pk = Column(String(40), nullable=True)
    raw_data = deferred(Column(Text, nullable=True))
    created_at = Column(DateTime, default=datetime.utcnow)


class FitnessMetric(Base):
    """Indicateurs de forme Garmin d'un jour (selon la montre : disposition, statut, VO2max, prédictions…)."""
    __tablename__ = "fitness_metrics"
    __table_args__ = (UniqueConstraint("user_id", "date", name="uq_fitness_day"),)

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    date = Column(Date, nullable=False)
    readiness_score = Column(Integer, nullable=True)       # disposition à l'entraînement, 0-100
    readiness_niveau = Column(String(20), nullable=True)
    readiness_conseil = Column(String(80), nullable=True)
    statut_entrainement = Column(String(30), nullable=True)
    charge_aigue = Column(Integer, nullable=True)
    charge_chronique = Column(Integer, nullable=True)
    vo2max = Column(Float, nullable=True)
    vo2max_velo = Column(Float, nullable=True)
    prediction_5k_s = Column(Integer, nullable=True)
    prediction_10k_s = Column(Integer, nullable=True)
    prediction_semi_s = Column(Integer, nullable=True)
    prediction_marathon_s = Column(Integer, nullable=True)
    endurance_score = Column(Integer, nullable=True)
    hill_score = Column(Integer, nullable=True)
    age_forme = Column(Float, nullable=True)
    raw_data = deferred(Column(Text, nullable=True))
    synced_at = Column(DateTime, nullable=True)
