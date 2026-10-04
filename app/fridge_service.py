from sqlalchemy.orm import Session
from app.models import FridgeItem, FridgeHistory, Ingredient, Recipe, MealLog, Preparation, PreparationIngredient

EPS = 1e-6
MAX_PREP_INGREDIENTS = 40


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


def recipe_composition(recipe: Recipe, portions: float) -> dict[int, float]:
    """Ingrédients de la recette d'origine (g / ml) pour ce nombre de portions, sans les options."""
    factor = portions / (recipe.portions or 1)
    out: dict[int, float] = {}
    for ri in recipe.ingredients:
        if ri.ingredient and ri.par_defaut:
            out[ri.ingredient_id] = out.get(ri.ingredient_id, 0) + to_base_qty(ri.ingredient, ri.quantite, ri.type_mesure) * factor
    return out


def _same_composition(a: dict[int, float], b: dict[int, float]) -> bool:
    # Tolérance : les quantités affichées sont arrondies (au gramme près)
    return a.keys() == b.keys() and all(abs(a[k] - b[k]) <= max(1.0, 0.02 * b[k]) for k in a)


def create_preparation(db: Session, user_id: int, recipe: Recipe, portions: float, when,
                       composition: dict[int, float] | None) -> Preparation:
    """Enregistre ce qui a été cuisiné. Sans composition : la recette d'origine à l'échelle."""
    original = recipe_composition(recipe, portions)
    comp = original if composition is None else composition
    prep = Preparation(user_id=user_id, recipe_id=recipe.id, portions=portions, date=when,
                       adaptee=not _same_composition(comp, original))
    prep.ingredients = [PreparationIngredient(ingredient_id=i, quantite=round(q, 2)) for i, q in comp.items() if q > EPS]
    db.add(prep)
    db.flush()
    return prep


def consume_preparation_ingredients(db: Session, user_id: int, prep: Preparation) -> list[str]:
    """Retire du frigo les ingrédients réellement utilisés (sans bloquer s'ils n'y sont pas)."""
    msgs = []
    for pi in prep.ingredients:
        taken = consume(db, user_id, pi.quantite, "cuisine", ingredient_id=pi.ingredient_id)
        if taken > EPS and pi.ingredient:
            msgs.append(f"{pi.ingredient.nom} −{taken:.0f} {pi.ingredient.unite}")
    return msgs


def pick_dish(db: Session, user_id: int, recipe_id: int, portions: float) -> FridgeItem | None:
    """Plat de cette recette au frigo : d'abord ceux qui ont assez de portions, puis celui qui périme le plus tôt."""
    dishes = (db.query(FridgeItem)
              .filter(FridgeItem.user_id == user_id, FridgeItem.recipe_id == recipe_id)
              .order_by(FridgeItem.date_peremption.asc().nulls_last(), FridgeItem.id).all())
    return next((d for d in dishes if d.quantite >= portions - EPS), dishes[0] if dishes else None)


def consume_dish(db: Session, log: MealLog, item: FridgeItem) -> list[str]:
    """Retire du plat les portions mangées (s'il en restait moins, le plat est terminé)."""
    take = min(item.quantite, log.quantite or 1)
    if take <= EPS:
        return []
    item.quantite -= take
    log_history(db, log.user_id, item, -take, "repas", log.id)
    recipe = db.get(Recipe, item.recipe_id) if item.recipe_id else None
    nom = recipe.nom if recipe else "Plat"
    if item.quantite <= EPS:
        remove_item(db, item)
        return [f"{nom} −{take:g} portion(s), plat terminé"]
    return [f"{nom} −{take:g} portion(s)"]


def consume_for_meal(db: Session, log: MealLog) -> list[str]:
    """Met à jour le frigo après un repas d'ingrédient. Ne lève jamais d'erreur si l'aliment est absent."""
    msgs = []
    if log.ingredient_id:
        ing = db.get(Ingredient, log.ingredient_id)
        if ing and log.quantite:
            qty = to_base_qty(ing, log.quantite, log.type_mesure)
            taken = consume(db, log.user_id, qty, "repas", log.id, ingredient_id=ing.id)
            if taken > EPS:
                msgs.append(f"{ing.nom} −{taken:.0f} {ing.unite}")
    return msgs
