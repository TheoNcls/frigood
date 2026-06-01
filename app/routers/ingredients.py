from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from app.database import get_db
from app.models import Ingredient
from app.schemas import IngredientCreate, IngredientRead
from app.auth import verify_api_key

router = APIRouter(prefix="/ingredients", tags=["ingredients"], dependencies=[Depends(verify_api_key)])


@router.get("/", response_model=list[IngredientRead])
def list_ingredients(db: Session = Depends(get_db)):
    return db.query(Ingredient).order_by(Ingredient.nom).all()


@router.get("/{id}", response_model=IngredientRead)
def get_ingredient(id: int, db: Session = Depends(get_db)):
    ingredient = db.get(Ingredient, id)
    if not ingredient:
        raise HTTPException(status_code=404, detail="Ingrédient introuvable")
    return ingredient


@router.post("/", response_model=IngredientRead)
def create_ingredient(data: IngredientCreate, db: Session = Depends(get_db)):
    ingredient = Ingredient(**data.model_dump())
    db.add(ingredient)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Un ingrédient nommé « {data.nom} » existe déjà")
    db.refresh(ingredient)
    return ingredient


@router.put("/{id}", response_model=IngredientRead)
def update_ingredient(id: int, data: IngredientCreate, db: Session = Depends(get_db)):
    ingredient = db.get(Ingredient, id)
    if not ingredient:
        raise HTTPException(status_code=404, detail="Ingrédient introuvable")
    for key, value in data.model_dump().items():
        setattr(ingredient, key, value)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Un ingrédient nommé « {data.nom} » existe déjà")
    db.refresh(ingredient)
    return ingredient


@router.delete("/{id}")
def delete_ingredient(id: int, db: Session = Depends(get_db)):
    ingredient = db.get(Ingredient, id)
    if not ingredient:
        raise HTTPException(status_code=404, detail="Ingrédient introuvable")
    db.delete(ingredient)
    db.commit()
    return {"message": "Ingrédient supprimé"}
