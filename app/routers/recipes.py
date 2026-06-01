from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from app.database import get_db
from app.models import Recipe, RecipeIngredient
from app.schemas import RecipeCreate, RecipeRead, RecipeIngredientCreate
from app.auth import verify_api_key

router = APIRouter(prefix="/recipes", tags=["recipes"], dependencies=[Depends(verify_api_key)])


@router.get("/", response_model=list[RecipeRead])
def list_recipes(db: Session = Depends(get_db)):
    return db.query(Recipe).all()


@router.get("/{id}", response_model=RecipeRead)
def get_recipe(id: int, db: Session = Depends(get_db)):
    recipe = db.get(Recipe, id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Recette introuvable")
    return recipe


@router.post("/", response_model=RecipeRead)
def create_recipe(data: RecipeCreate, db: Session = Depends(get_db)):
    recipe = Recipe(**data.model_dump())
    db.add(recipe)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Une recette nommée « {data.nom} » existe déjà")
    db.refresh(recipe)
    return recipe


@router.put("/{id}", response_model=RecipeRead)
def update_recipe(id: int, data: RecipeCreate, db: Session = Depends(get_db)):
    recipe = db.get(Recipe, id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Recette introuvable")
    for key, value in data.model_dump().items():
        setattr(recipe, key, value)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Une recette nommée « {data.nom} » existe déjà")
    db.refresh(recipe)
    return recipe


@router.delete("/{id}")
def delete_recipe(id: int, db: Session = Depends(get_db)):
    recipe = db.get(Recipe, id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Recette introuvable")
    db.delete(recipe)
    db.commit()
    return {"message": "Recette supprimée"}


@router.post("/{id}/ingredients", response_model=RecipeRead)
def add_ingredient_to_recipe(id: int, data: RecipeIngredientCreate, db: Session = Depends(get_db)):
    recipe = db.get(Recipe, id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Recette introuvable")
    lien = RecipeIngredient(recipe_id=id, **data.model_dump())
    db.add(lien)
    db.commit()
    db.refresh(recipe)
    return recipe


@router.delete("/{id}/ingredients/{ingredient_id}")
def remove_ingredient_from_recipe(id: int, ingredient_id: int, db: Session = Depends(get_db)):
    lien = db.query(RecipeIngredient).filter_by(recipe_id=id, ingredient_id=ingredient_id).first()
    if not lien:
        raise HTTPException(status_code=404, detail="Ingrédient non trouvé dans cette recette")
    db.delete(lien)
    db.commit()
    return {"message": "Ingrédient retiré de la recette"}
