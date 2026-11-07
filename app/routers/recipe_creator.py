"""Créateur de recettes : brouillon complété par Claude (comptes avec le coach IA) ou par une autre IA (copier-coller),
puis création de la recette. Ses nouveaux ingrédients sont d'abord créés (et vérifiés) avec la fiche du catalogue."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import recipe_creator
from app.auth import Principal, check_user_access, get_principal
from app.catalog_access import check_name_free, is_visible
from app.coach import CoachError
from app.database import get_db
from app.models import Ingredient, Recipe, RecipeIngredient, User
from app.routers.coach import COACH_NON_AUTORISE
from app.schemas import CoachManualIn, CreatorDraft, CreatorSave, RecipeRead

router = APIRouter(tags=["recipe_creator"], dependencies=[Depends(get_principal)])


def _user(db: Session, user_id: int, principal: Principal) -> User:
    check_user_access(principal, user_id)
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    return user


@router.post("/users/{user_id}/recipe_creator/ai")
def complete_with_claude(user_id: int, draft: CreatorDraft, principal: Principal = Depends(get_principal),
                         db: Session = Depends(get_db)):
    """Claude complète le brouillon (comptes avec le coach IA : chaque appel est payant)."""
    user = _user(db, user_id, principal)
    if not principal.is_service and not user.coach_access:
        raise HTTPException(status_code=403, detail=COACH_NON_AUTORISE)
    catalog = recipe_creator.catalog_for(db, principal)
    context = recipe_creator.build_context(db, user, draft.model_dump(), catalog)
    try:
        proposal, _usage = recipe_creator.ask_claude(context, catalog)
    except CoachError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return proposal


@router.post("/users/{user_id}/recipe_creator/prompt")
def prompt_for_other_ai(user_id: int, draft: CreatorDraft, principal: Principal = Depends(get_principal),
                        db: Session = Depends(get_db)):
    """Le texte qu'aurait reçu Claude, à coller dans une autre IA (ouvert à tous : aucun coût)."""
    user = _user(db, user_id, principal)
    catalog = recipe_creator.catalog_for(db, principal)
    context = recipe_creator.build_context(db, user, draft.model_dump(), catalog)
    return {"texte": recipe_creator.external_prompt(context)}


@router.post("/users/{user_id}/recipe_creator/parse")
def parse_other_ai(user_id: int, data: CoachManualIn, principal: Principal = Depends(get_principal),
                   db: Session = Depends(get_db)):
    """Relit la réponse collée d'une autre IA : la même proposition que Claude, pour remplir le formulaire."""
    _user(db, user_id, principal)
    try:
        return recipe_creator.parse_external(data.texte, recipe_creator.catalog_for(db, principal))
    except CoachError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/users/{user_id}/recipe_creator/save", response_model=RecipeRead)
def save_recipe(user_id: int, data: CreatorSave, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """Crée la recette (tout ou rien). Ses ingrédients doivent déjà être au catalogue : un nouvel ingrédient se crée
    avec la fiche habituelle (Claude, autre IA, code-barre ou à la main), pour vérifier ses valeurs."""
    _user(db, user_id, principal)
    check_name_free(db, Recipe, data.nom, principal, "Une recette")
    # Même nom qu'un ingrédient du catalogue (« Oeuf » = « Œuf ») : c'est lui ; sinon il reste à créer
    known = {recipe_creator.norm(i.nom): i for i in recipe_creator.catalog_for(db, principal)}
    missing = [it.nom or "?" for it in data.ingredients if not it.ingredient_id and recipe_creator.norm(it.nom or "") not in known]
    if missing:
        raise HTTPException(status_code=400, detail=f"Crée d'abord dans le catalogue : {', '.join(missing)}")
    try:
        recipe = Recipe(nom=data.nom, description=(data.description or "").strip() or None,
                        categorie=(data.categorie or "").strip() or None, portions=data.portions,
                        temps_preparation=data.temps_preparation, created_by=principal.user_id or 0, valide=principal.is_admin)
        db.add(recipe)
        db.flush()
        used = set()
        for it in data.ingredients:
            label = it.nom or f"ingrédient {it.ingredient_id}"
            if not it.quantite or it.quantite <= 0:
                raise HTTPException(status_code=400, detail=f"Indique une quantité pour « {label} »")
            if it.ingredient_id:
                ingredient = db.get(Ingredient, it.ingredient_id)
                if not ingredient or not is_visible(ingredient, principal):
                    raise HTTPException(status_code=404, detail=f"Ingrédient introuvable : « {label} »")
            else:
                ingredient = known[recipe_creator.norm(it.nom or "")]
            if ingredient.id in used:
                continue   # deux fois le même : on garde le premier
            used.add(ingredient.id)
            db.add(RecipeIngredient(recipe_id=recipe.id, ingredient_id=ingredient.id, quantite=it.quantite,
                                    type_mesure=it.type_mesure, par_defaut=it.par_defaut))
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(recipe)
    return recipe
