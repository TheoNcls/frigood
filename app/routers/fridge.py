from datetime import date, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import FridgeItem, FridgeHistory, Ingredient, MealLog, Recipe, User
from app.schemas import FridgeItemCreate, FridgeItemUpdate, FridgeItemRead, FridgeHistoryRead
from app.auth import Principal, get_principal, check_user_access
from app.catalog_access import is_visible
from app.fridge_service import (
    MAX_PREP_INGREDIENTS, consume_preparation_ingredients, create_preparation, log_history, remove_item,
)

router = APIRouter(tags=["fridge"], dependencies=[Depends(get_principal)])

DUREE_RECETTE_DEFAUT = 3  # jours pour un plat cuisiné


def _get_own_item(db: Session, id: int, principal: Principal) -> FridgeItem:
    item = db.get(FridgeItem, id)
    if not item:
        raise HTTPException(status_code=404, detail="Élément introuvable")
    check_user_access(principal, item.user_id)
    return item


@router.get("/users/{user_id}/fridge/", response_model=list[FridgeItemRead])
def list_fridge(user_id: int, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    check_user_access(principal, user_id)
    return (db.query(FridgeItem)
            .filter(FridgeItem.user_id == user_id)
            .order_by(FridgeItem.date_peremption.asc().nulls_last(), FridgeItem.id)
            .all())


@router.get("/users/{user_id}/fridge/history", response_model=list[FridgeHistoryRead])
def fridge_history(user_id: int, limit: int = Query(default=200, le=1000),
                   principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    check_user_access(principal, user_id)
    return (db.query(FridgeHistory)
            .filter(FridgeHistory.user_id == user_id)
            .order_by(FridgeHistory.created_at.desc(), FridgeHistory.id.desc())
            .limit(limit)
            .all())


@router.post("/users/{user_id}/fridge/", response_model=FridgeItemRead)
def add_to_fridge(user_id: int, data: FridgeItemCreate, principal: Principal = Depends(get_principal),
                  db: Session = Depends(get_db)):
    check_user_access(principal, user_id)
    if not db.get(User, user_id):
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    if bool(data.ingredient_id) == bool(data.recipe_id):
        raise HTTPException(status_code=400, detail="Indique soit un ingrédient, soit une recette")
    if data.quantite <= 0:
        raise HTTPException(status_code=400, detail="La quantité doit être positive")

    date_achat = data.date_achat or date.today()
    date_peremption = data.date_peremption
    recipe = None
    composition = None

    if data.ingredient_id:
        ing = db.get(Ingredient, data.ingredient_id)
        if not ing or not is_visible(ing, principal):
            raise HTTPException(status_code=404, detail="Ingrédient introuvable")
        if date_peremption is None:
            date_peremption = date_achat + timedelta(days=ing.duree_conservation or 7)
    else:
        recipe = db.get(Recipe, data.recipe_id)
        if not recipe or not is_visible(recipe, principal):
            raise HTTPException(status_code=404, detail="Recette introuvable")
        if date_peremption is None:
            date_peremption = date_achat + timedelta(days=DUREE_RECETTE_DEFAUT)
        if data.ingredients is not None:
            composition = {}
            for row in data.ingredients:
                if row.quantite <= 0:
                    continue
                row_ing = db.get(Ingredient, row.ingredient_id)
                if not row_ing or not is_visible(row_ing, principal):
                    raise HTTPException(status_code=404, detail="Ingrédient introuvable")
                composition[row.ingredient_id] = composition.get(row.ingredient_id, 0) + row.quantite
            if not composition:
                raise HTTPException(status_code=400, detail="Coche au moins un ingrédient")
            if len(composition) > MAX_PREP_INGREDIENTS:
                raise HTTPException(status_code=400, detail=f"{MAX_PREP_INGREDIENTS} ingrédients maximum")

    # Plat cuisiné : ce qui a réellement été préparé (la recette, ou ta version)
    prep = create_preparation(db, user_id, recipe, data.quantite, date_achat, composition) if recipe else None
    item = FridgeItem(
        user_id=user_id,
        ingredient_id=data.ingredient_id,
        recipe_id=data.recipe_id,
        quantite=data.quantite,
        date_achat=date_achat,
        date_peremption=date_peremption,
        preparation_id=prep.id if prep else None,
    )
    db.add(item)
    db.flush()
    log_history(db, user_id, item, data.quantite, "ajout")

    # On retire du frigo les ingrédients utilisés (sans bloquer si absents)
    if prep and data.deduire_ingredients:
        consume_preparation_ingredients(db, user_id, prep)

    db.commit()
    db.refresh(item)
    return item


@router.put("/fridge/{id}", response_model=FridgeItemRead)
def update_fridge_item(id: int, data: FridgeItemUpdate, principal: Principal = Depends(get_principal),
                       db: Session = Depends(get_db)):
    item = _get_own_item(db, id, principal)
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
def delete_fridge_item(id: int, raison: str = Query(default="suppression"),
                       principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    item = _get_own_item(db, id, principal)
    action = raison if raison in ("suppression", "perime", "consomme") else "suppression"

    if action == "suppression":
        # Erreur de saisie : l'élément n'aurait jamais dû exister, on efface aussi son historique
        linked = db.query(FridgeHistory).filter(FridgeHistory.fridge_item_id == item.id)
        if linked.count():
            linked.delete(synchronize_session=False)
        else:
            # Élément ajouté avant l'existence du lien : on retrouve sa ligne d'ajout par l'aliment et les dates
            query = db.query(FridgeHistory).filter(
                FridgeHistory.user_id == item.user_id,
                FridgeHistory.action == "ajout",
                FridgeHistory.fridge_item_id.is_(None),
                FridgeHistory.date_achat == item.date_achat,
            )
            if item.ingredient_id:
                query = query.filter(FridgeHistory.ingredient_id == item.ingredient_id)
            else:
                query = query.filter(FridgeHistory.recipe_id == item.recipe_id)
            ajout = query.order_by(FridgeHistory.id.desc()).first()
            if ajout:
                db.delete(ajout)
        prep = item.preparation
        db.delete(item)
        # Préparation saisie par erreur : inutile de la garder si aucun repas n'en vient
        if prep and not db.query(MealLog).filter(MealLog.preparation_id == prep.id).count():
            db.delete(prep)
    else:
        log_history(db, item.user_id, item, -item.quantite, action)
        remove_item(db, item)

    db.commit()
    return {"message": "Retiré du frigo"}
