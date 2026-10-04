from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import date as date_type
from app.database import get_db
from app.models import FridgeItem, Ingredient, MealLog, Recipe, User
from app.schemas import MealLogCreate, MealLogRead
from app.auth import Principal, get_principal, check_user_access
from app.fridge_service import consume_dish, consume_for_meal, pick_dish

router = APIRouter(tags=["meal_logs"], dependencies=[Depends(get_principal)])


@router.post("/users/{user_id}/meal_logs/", response_model=MealLogRead)
def add_meal_log(user_id: int, data: MealLogCreate, principal: Principal = Depends(get_principal),
                 db: Session = Depends(get_db)):
    check_user_access(principal, user_id)
    if not db.get(User, user_id):
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    values = data.model_dump(exclude={"fridge_item_id"})
    dish = None
    # Une recette se mange à partir d'un plat préparé (dans le frigo) : on en prend une part
    if data.fridge_item_id or values["recipe_id"]:
        portions = values["quantite"] or 1
        if data.fridge_item_id:
            dish = db.get(FridgeItem, data.fridge_item_id)
            if not dish or dish.user_id != user_id or not dish.recipe_id:
                raise HTTPException(status_code=404, detail="Plat introuvable dans ton frigo")
        else:
            dish = pick_dish(db, user_id, values["recipe_id"], portions)
            if not dish:
                recipe = db.get(Recipe, values["recipe_id"])
                nom = f"« {recipe.nom} »" if recipe else "Cette recette"
                raise HTTPException(status_code=400, detail=f"{nom} n'est pas dans ton frigo : prépare-la d'abord")
        values.update(recipe_id=dish.recipe_id, ingredient_id=None, quantite=portions, type_mesure="poids",
                      preparation_id=dish.preparation_id)
    # « À l'unité » ne sert qu'à saisir plus vite : on enregistre la quantité réelle en g / ml
    if values["ingredient_id"] and values["type_mesure"] == "unite" and values["quantite"] is not None:
        ing = db.get(Ingredient, values["ingredient_id"])
        if ing and ing.quantite_defaut:
            values["quantite"] = round(values["quantite"] * ing.quantite_defaut, 2)
            values["type_mesure"] = "poids"
    log = MealLog(user_id=user_id, **values)
    db.add(log)
    db.commit()
    db.refresh(log)

    # Le repas est déjà enregistré : un souci côté frigo ne doit jamais le bloquer
    try:
        updates = consume_dish(db, log, dish) if dish else consume_for_meal(db, log)
        db.commit()
    except Exception:
        db.rollback()
        updates = []
    db.refresh(log)
    log.fridge_updates = updates
    return log


@router.get("/users/{user_id}/meal_logs/", response_model=list[MealLogRead])
def list_meal_logs(
    user_id: int,
    date: date_type | None = Query(default=None),
    date_from: date_type | None = Query(default=None),
    date_to: date_type | None = Query(default=None),
    principal: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    check_user_access(principal, user_id)
    query = db.query(MealLog).filter(MealLog.user_id == user_id)
    if date:
        query = query.filter(MealLog.date == date)
    if date_from:
        query = query.filter(MealLog.date >= date_from)
    if date_to:
        query = query.filter(MealLog.date <= date_to)
    return query.order_by(MealLog.date, MealLog.id).all()


@router.delete("/meal_logs/{id}")
def delete_meal_log(id: int, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    log = db.get(MealLog, id)
    if not log:
        raise HTTPException(status_code=404, detail="Log introuvable")
    check_user_access(principal, log.user_id)
    db.delete(log)
    db.commit()
    return {"message": "Repas supprimé"}
