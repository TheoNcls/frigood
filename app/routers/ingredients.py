import os
from fastapi import APIRouter, Depends, HTTPException, Query
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


# Doit être AVANT /{id} pour ne pas être capturé par le param dynamique
@router.get("/from_claude")
def ingredient_from_claude(nom: str = Query(...)):
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="ANTHROPIC_API_KEY non configurée")
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)

        tool = {
            "name": "valeurs_nutritionnelles",
            "description": "Retourne les valeurs nutritionnelles d'un aliment pour 100g",
            "input_schema": {
                "type": "object",
                "properties": {
                    "nom": {"type": "string", "description": "Nom normalisé de l'aliment en français"},
                    "description": {"type": "string", "description": "Brève description de l'aliment"},
                    "categorie": {"type": "string", "description": "Catégorie : légume, fruit, légumineuse, céréale, produit laitier, matière grasse, boisson..."},
                    "calories": {"type": "number", "description": "kcal pour 100g"},
                    "proteines": {"type": "number", "description": "g pour 100g"},
                    "glucides": {"type": "number", "description": "g pour 100g"},
                    "lipides": {"type": "number", "description": "g pour 100g"},
                    "unite": {"type": "string", "description": "Unité principale (g pour solides, cl pour liquides)"},
                    "quantite_defaut": {"type": "number", "description": "Poids typique d'une unité en g (ex: 130 pour une pomme moyenne). Null si pas d'unité naturelle."},
                    "nutriments": {
                        "type": "array",
                        "description": "Nutriments supplémentaires importants (fibres, vitamines, minéraux)",
                        "items": {
                            "type": "object",
                            "properties": {
                                "nom": {"type": "string"},
                                "unite": {"type": "string", "description": "g, mg ou µg"},
                                "valeur": {"type": "number", "description": "Valeur pour 100g"}
                            },
                            "required": ["nom", "unite", "valeur"]
                        }
                    }
                },
                "required": ["nom", "calories", "proteines", "glucides", "lipides", "unite"]
            }
        }

        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            tools=[tool],
            tool_choice={"type": "any"},
            messages=[{
                "role": "user",
                "content": (
                    f"Donne-moi les valeurs nutritionnelles précises pour 100g de « {nom} ». "
                    "Utilise les tables officielles (CIQUAL France ou USDA). "
                    "Inclus les principaux nutriments supplémentaires : fibres alimentaires, "
                    "vitamines et minéraux importants pour cet aliment. "
                    "Pour les liquides (jus, lait, huile...) utilise 'cl' comme unité."
                )
            }]
        )

        for block in response.content:
            if block.type == "tool_use":
                return block.input

        raise HTTPException(status_code=500, detail="Claude n'a pas retourné de données structurées")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur Claude API : {str(e)}")


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
