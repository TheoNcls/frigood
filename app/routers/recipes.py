from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from app.database import get_db
from app.models import Ingredient, Recipe, RecipeIngredient
from app.schemas import RecipeCreate, RecipeRead, RecipeIngredientCreate, RecipeIngredientUpdate
from app.auth import Principal, get_principal
from app.catalog_access import check_can_edit, check_name_free, is_visible, visible

router = APIRouter(prefix="/recipes", tags=["recipes"], dependencies=[Depends(get_principal)])


def _recipe(db: Session, id: int, principal: Principal, edit: bool = False) -> Recipe:
    recipe = db.get(Recipe, id)
    if not recipe or not is_visible(recipe, principal):
        raise HTTPException(status_code=404, detail="Recette introuvable")
    if edit:
        check_can_edit(recipe, principal, "les recettes")
    return recipe


@router.get("/", response_model=list[RecipeRead])
def list_recipes(tous: bool = Query(default=False, description="Administration : toutes les recettes, validées ou non"),
                 principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """Recettes validées et celles de la personne."""
    return visible(db.query(Recipe), Recipe, principal, everything=tous).all()


@router.get("/{id}", response_model=RecipeRead)
def get_recipe(id: int, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    return _recipe(db, id, principal)


@router.post("/", response_model=RecipeRead)
def create_recipe(data: RecipeCreate, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """Tout le monde peut créer une recette : validée d'office pour l'administration, à valider sinon."""
    check_name_free(db, Recipe, data.nom, principal, "Une recette")
    recipe = Recipe(**data.model_dump(), created_by=principal.user_id or 0, valide=principal.is_admin)
    db.add(recipe)
    db.commit()
    db.refresh(recipe)
    return recipe


@router.put("/{id}", response_model=RecipeRead)
def update_recipe(id: int, data: RecipeCreate, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    recipe = _recipe(db, id, principal, edit=True)
    check_name_free(db, Recipe, data.nom, principal, "Une recette", exclude_id=id)
    for key, value in data.model_dump().items():
        setattr(recipe, key, value)
    db.commit()
    db.refresh(recipe)
    return recipe


@router.delete("/{id}")
def delete_recipe(id: int, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    recipe = _recipe(db, id, principal, edit=True)
    for lien in list(recipe.ingredients):
        db.delete(lien)
    db.delete(recipe)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"« {recipe.nom} » est utilisée dans des repas enregistrés : elle ne peut pas être supprimée")
    return {"message": "Recette supprimée"}


@router.post("/{id}/ingredients", response_model=RecipeRead)
def add_ingredient_to_recipe(id: int, data: RecipeIngredientCreate, principal: Principal = Depends(get_principal),
                             db: Session = Depends(get_db)):
    recipe = _recipe(db, id, principal, edit=True)
    ingredient = db.get(Ingredient, data.ingredient_id)
    if not ingredient or not is_visible(ingredient, principal):
        raise HTTPException(status_code=404, detail="Ingrédient introuvable")
    lien = RecipeIngredient(recipe_id=id, **data.model_dump())
    db.add(lien)
    db.commit()
    db.refresh(recipe)
    return recipe


@router.put("/{id}/ingredients/{ingredient_id}", response_model=RecipeRead)
def update_recipe_ingredient(id: int, ingredient_id: int, data: RecipeIngredientUpdate,
                             principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    recipe = _recipe(db, id, principal, edit=True)
    lien = db.query(RecipeIngredient).filter_by(recipe_id=id, ingredient_id=ingredient_id).first()
    if not lien:
        raise HTTPException(status_code=404, detail="Ingrédient non trouvé dans cette recette")
    changes = data.model_dump(exclude_none=True)
    if "quantite" in changes and changes["quantite"] <= 0:
        raise HTTPException(status_code=400, detail="La quantité doit être positive")
    for key, value in changes.items():
        setattr(lien, key, value)
    db.commit()
    db.refresh(recipe)
    return recipe


@router.delete("/{id}/ingredients/{ingredient_id}")
def remove_ingredient_from_recipe(id: int, ingredient_id: int, principal: Principal = Depends(get_principal),
                                  db: Session = Depends(get_db)):
    _recipe(db, id, principal, edit=True)
    lien = db.query(RecipeIngredient).filter_by(recipe_id=id, ingredient_id=ingredient_id).first()
    if not lien:
        raise HTTPException(status_code=404, detail="Ingrédient non trouvé dans cette recette")
    db.delete(lien)
    db.commit()
    return {"message": "Ingrédient retiré de la recette"}
