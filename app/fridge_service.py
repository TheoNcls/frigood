from sqlalchemy.orm import Session
from app.models import FridgeItem, FridgeHistory, Ingredient, Recipe, MealLog

EPS = 1e-6


def to_base_qty(ingredient: Ingredient, quantite: float, type_mesure: str | None) -> float:
    """Convertit une quantité en unité de base de l'ingrédient (g/cl)."""
    if type_mesure == "unite":
        return quantite * (ingredient.quantite_defaut or 0)
    return quantite


def log_history(db: Session, user_id: int, item: FridgeItem, quantite: float, action: str,
                meal_log_id: int | None = None, notes: str | None = None):
    db.add(FridgeHistory(
        user_id=user_id,
        ingredient_id=item.ingredient_id,
        recipe_id=item.recipe_id,
        quantite=quantite,
        action=action,
        meal_log_id=meal_log_id,
        fridge_item_id=item.id,
        date_achat=item.date_achat,
        date_peremption=item.date_peremption,
        notes=notes,
    ))


def remove_item(db: Session, item: FridgeItem):
    """Retire un élément du frigo en gardant son historique, détaché de l'élément disparu."""
    db.flush()
    (db.query(FridgeHistory)
     .filter(FridgeHistory.fridge_item_id == item.id)
     .update({FridgeHistory.fridge_item_id: None}, synchronize_session=False))
    db.delete(item)


def consume(db: Session, user_id: int, qty: float, action: str, meal_log_id: int | None = None,
            *, ingredient_id: int | None = None, recipe_id: int | None = None) -> float:
    """Retire qty du frigo, en commençant par ce qui périme le plus tôt.
    Retourne la quantité réellement retirée (peut être 0 si rien au frigo)."""
    query = db.query(FridgeItem).filter(FridgeItem.user_id == user_id)
    if ingredient_id:
        query = query.filter(FridgeItem.ingredient_id == ingredient_id)
    else:
        query = query.filter(FridgeItem.recipe_id == recipe_id)
    items = query.order_by(FridgeItem.date_peremption.asc().nulls_last(), FridgeItem.id).all()

    remaining = qty
    for item in items:
        if remaining <= EPS:
            break
        take = min(item.quantite, remaining)
        item.quantite -= take
        remaining -= take
        log_history(db, user_id, item, -take, action, meal_log_id)
        if item.quantite <= EPS:
            remove_item(db, item)
    return qty - remaining


def consume_recipe_ingredients(db: Session, user_id: int, recipe: Recipe, factor: float,
                               action: str, meal_log_id: int | None = None) -> list[str]:
    """Retire les ingrédients d'une recette (factor = fraction de la recette complète)."""
    msgs = []
    for ri in recipe.ingredients:
        qty = to_base_qty(ri.ingredient, ri.quantite, ri.type_mesure) * factor
        if qty <= EPS:
            continue
        taken = consume(db, user_id, qty, action, meal_log_id, ingredient_id=ri.ingredient_id)
        if taken > EPS:
            msgs.append(f"{ri.ingredient.nom} −{taken:.0f} {ri.ingredient.unite}")
    return msgs


def consume_for_meal(db: Session, log: MealLog) -> list[str]:
    """Met à jour le frigo après un repas. Ne lève jamais d'erreur si l'aliment est absent."""
    msgs = []
    if log.ingredient_id:
        ing = db.get(Ingredient, log.ingredient_id)
        if ing and log.quantite:
            qty = to_base_qty(ing, log.quantite, log.type_mesure)
            taken = consume(db, log.user_id, qty, "repas", log.id, ingredient_id=ing.id)
            if taken > EPS:
                msgs.append(f"{ing.nom} −{taken:.0f} {ing.unite}")
    elif log.recipe_id:
        recipe = db.get(Recipe, log.recipe_id)
        if recipe:
            portions = log.quantite or 1
            taken = consume(db, log.user_id, portions, "repas", log.id, recipe_id=recipe.id)
            if taken > EPS:
                msgs.append(f"{recipe.nom} −{taken:g} portion(s)")
            # Portions non couvertes par un plat déjà prêt : on puise dans les ingrédients bruts
            rest = portions - taken
            if rest > EPS:
                factor = rest / (recipe.portions or 1)
                msgs += consume_recipe_ingredients(db, log.user_id, recipe, factor, "repas", log.id)
    return msgs
