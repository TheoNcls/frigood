from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from app.database import get_db
from app.models import Nutriment, IngredientNutriment
from app.schemas import NutrimentCreate, NutrimentRead, IngredientNutrimentCreate, IngredientNutrimentRead
from app.auth import verify_api_key

router = APIRouter(tags=["nutriments"], dependencies=[Depends(verify_api_key)])


@router.get("/nutriments/", response_model=list[NutrimentRead])
def list_nutriments(db: Session = Depends(get_db)):
    return db.query(Nutriment).all()


@router.post("/nutriments/", response_model=NutrimentRead)
def create_nutriment(data: NutrimentCreate, db: Session = Depends(get_db)):
    nutriment = Nutriment(**data.model_dump())
    db.add(nutriment)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Le nutriment « {data.nom} » existe déjà")
    db.refresh(nutriment)
    return nutriment


@router.delete("/nutriments/{id}")
def delete_nutriment(id: int, db: Session = Depends(get_db)):
    nutriment = db.get(Nutriment, id)
    if not nutriment:
        raise HTTPException(status_code=404, detail="Nutriment introuvable")
    db.delete(nutriment)
    db.commit()
    return {"message": "Nutriment supprimé"}


@router.post("/ingredients/{ingredient_id}/nutriments/", response_model=IngredientNutrimentRead)
def add_nutriment_to_ingredient(ingredient_id: int, data: IngredientNutrimentCreate, db: Session = Depends(get_db)):
    lien = IngredientNutriment(ingredient_id=ingredient_id, **data.model_dump())
    db.add(lien)
    db.commit()
    db.refresh(lien)
    return lien


@router.delete("/ingredients/{ingredient_id}/nutriments/{nutriment_id}")
def remove_nutriment_from_ingredient(ingredient_id: int, nutriment_id: int, db: Session = Depends(get_db)):
    lien = db.query(IngredientNutriment).filter_by(
        ingredient_id=ingredient_id, nutriment_id=nutriment_id
    ).first()
    if not lien:
        raise HTTPException(status_code=404, detail="Nutriment non trouvé pour cet ingrédient")
    db.delete(lien)
    db.commit()
    return {"message": "Nutriment retiré"}
