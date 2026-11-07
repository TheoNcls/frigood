"""Créateur de recettes : brouillon complété par Claude (comptes avec le coach IA) ou par une autre IA (copier-coller),
puis création de la recette et de ses nouveaux ingrédients d'un coup."""
import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app import recipe_creator
from app.auth import Principal, check_user_access, get_principal
from app.catalog_access import check_name_free, is_visible
from app.coach import CoachError
from app.database import get_db
from app.models import Ingredient, IngredientSource, Recipe, RecipeIngredient, User
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


def _new_ingredient(db: Session, it, principal: Principal, known: dict[str, Ingredient]) -> Ingredient:
    """Ingrédient pas encore au catalogue : repris s'il existe déjà sous ce nom (« Oeuf » = « Œuf »),
    sinon créé (avec les valeurs de l'IA)."""
    nom = (it.nom or "").strip()
    if not nom:
        raise HTTPException(status_code=400, detail="Un nouvel ingrédient n'a pas de nom")
    if (same := known.get(recipe_creator.norm(nom))):
        return same
    existing = db.query(Ingredient).filter(func.lower(Ingredient.nom) == nom.lower()).first()
    if existing:
        if is_visible(existing, principal):
            return existing
        raise HTTPException(status_code=400, detail=f"Un ingrédient « {existing.nom} » existe déjà (ajouté par quelqu'un d'autre, "
                                                    "à valider) : choisis un nom plus précis")
    n = it.nutrition or {}
    ingredient = Ingredient(
        nom=nom[:120], unite="ml" if (it.unite or n.get("unite")) == "ml" else "g",
        categorie=n.get("categorie"), calories=n.get("calories"), proteines=n.get("proteines"),
        glucides=n.get("glucides"), lipides=n.get("lipides"), quantite_defaut=n.get("quantite_defaut"),
        duree_conservation=n.get("duree_conservation") or 7, regime=n.get("regime"),
        created_by=principal.user_id or 0, valide=principal.is_admin,
    )
    db.add(ingredient)
    db.flush()
    known[recipe_creator.norm(nom)] = ingredient
    if n.get("calories") is not None:
        db.add(IngredientSource(ingredient_id=ingredient.id, source_type="ia",
                                raw_data=json.dumps({"source": "createur_recette", "valeurs": n}, ensure_ascii=False)))
    return ingredient


@router.post("/users/{user_id}/recipe_creator/save", response_model=RecipeRead)
def save_recipe(user_id: int, data: CreatorSave, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """Crée la recette et ses nouveaux ingrédients d'un coup (tout ou rien), comme un ajout au catalogue."""
    _user(db, user_id, principal)
    check_name_free(db, Recipe, data.nom, principal, "Une recette")
    try:
        recipe = Recipe(nom=data.nom, description=(data.description or "").strip() or None,
                        categorie=(data.categorie or "").strip() or None, portions=data.portions,
                        temps_preparation=data.temps_preparation, created_by=principal.user_id or 0, valide=principal.is_admin)
        db.add(recipe)
        db.flush()
        used = set()
        known = {recipe_creator.norm(i.nom): i for i in recipe_creator.catalog_for(db, principal)}
        for it in data.ingredients:
            label = it.nom or f"ingrédient {it.ingredient_id}"
            if not it.quantite or it.quantite <= 0:
                raise HTTPException(status_code=400, detail=f"Indique une quantité pour « {label} »")
            if it.ingredient_id:
                ingredient = db.get(Ingredient, it.ingredient_id)
                if not ingredient or not is_visible(ingredient, principal):
                    raise HTTPException(status_code=404, detail=f"Ingrédient introuvable : « {label} »")
            else:
                ingredient = _new_ingredient(db, it, principal, known)
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
