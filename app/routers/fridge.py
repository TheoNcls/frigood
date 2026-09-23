from datetime import date, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import FridgeItem, FridgeHistory, Ingredient, Recipe, User
from app.schemas import FridgeItemCreate, FridgeItemUpdate, FridgeItemRead, FridgeHistoryRead
from app.auth import verify_api_key
from app.fridge_service import log_history, consume_recipe_ingredients

router = APIRouter(tags=["fridge"], dependencies=[Depends(verify_api_key)])

DUREE_RECETTE_DEFAUT = 3  # jours pour un plat cuisiné


@router.get("/users/{user_id}/fridge/", response_model=list[FridgeItemRead])
def list_fridge(user_id: int, db: Session = Depends(get_db)):
    return (db.query(FridgeItem)
            .filter(FridgeItem.user_id == user_id)
            .order_by(FridgeItem.date_peremption.asc().nulls_last(), FridgeItem.id)
            .all())


@router.get("/users/{user_id}/fridge/history", response_model=list[FridgeHistoryRead])
def fridge_history(user_id: int, limit: int = Query(default=200, le=1000), db: Session = Depends(get_db)):
    return (db.query(FridgeHistory)
            .filter(FridgeHistory.user_id == user_id)
            .order_by(FridgeHistory.created_at.desc(), FridgeHistory.id.desc())
            .limit(limit)
            .all())


@router.post("/users/{user_id}/fridge/", response_model=FridgeItemRead)
def add_to_fridge(user_id: int, data: FridgeItemCreate, db: Session = Depends(get_db)):
    if not db.get(User, user_id):
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    if bool(data.ingredient_id) == bool(data.recipe_id):
        raise HTTPException(status_code=400, detail="Indique soit un ingrédient, soit une recette")
    if data.quantite <= 0:
        raise HTTPException(status_code=400, detail="La quantité doit être positive")

    date_achat = data.date_achat or date.today()
    date_peremption = data.date_peremption
    recipe = None

    if data.ingredient_id:
        ing = db.get(Ingredient, data.ingredient_id)
        if not ing:
            raise HTTPException(status_code=404, detail="Ingrédient introuvable")
        if date_peremption is None:
            date_peremption = date_achat + timedelta(days=ing.duree_conservation or 7)
    else:
        recipe = db.get(Recipe, data.recipe_id)
        if not recipe:
            raise HTTPException(status_code=404, detail="Recette introuvable")
        if date_peremption is None:
            date_peremption = date_achat + timedelta(days=DUREE_RECETTE_DEFAUT)

    item = FridgeItem(
        user_id=user_id,
        ingredient_id=data.ingredient_id,
        recipe_id=data.recipe_id,
        quantite=data.quantite,
        date_achat=date_achat,
        date_peremption=date_peremption,
    )
    db.add(item)
    db.flush()
    log_history(db, user_id, item, data.quantite, "ajout")

    # Plat cuisiné : on retire du frigo les ingrédients utilisés (sans bloquer si absents)
    if recipe and data.deduire_ingredients:
        factor = data.quantite / (recipe.portions or 1)
        consume_recipe_ingredients(db, user_id, recipe, factor, "cuisine")

    db.commit()
    db.refresh(item)
    return item


@router.put("/fridge/{id}", response_model=FridgeItemRead)
def update_fridge_item(id: int, data: FridgeItemUpdate, db: Session = Depends(get_db)):
    item = db.get(FridgeItem, id)
    if not item:
        raise HTTPException(status_code=404, detail="Élément introuvable")
    changes = data.model_dump(exclude_unset=True)
    old_q = item.quantite
    for key, value in changes.items():
        setattr(item, key, value)
    if item.quantite is None or item.quantite <= 0:
        raise HTTPException(status_code=400, detail="La quantité doit être positive (supprime l'élément sinon)")
    log_history(db, item.user_id, item, item.quantite - old_q, "modification")
    db.commit()
    db.refresh(item)
    return item


@router.delete("/fridge/{id}")
def delete_fridge_item(id: int, raison: str = Query(default="suppression"), db: Session = Depends(get_db)):
    item = db.get(FridgeItem, id)
    if not item:
        raise HTTPException(status_code=404, detail="Élément introuvable")
    action = raison if raison in ("suppression", "perime", "consomme") else "suppression"
    log_history(db, item.user_id, item, -item.quantite, action)
    db.delete(item)
    db.commit()
    return {"message": "Retiré du frigo"}
