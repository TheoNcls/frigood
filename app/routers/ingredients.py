import os
import json
from datetime import datetime
import requests as http_requests
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from app.database import get_db
from app import openfoodfacts as off
from app.models import Ingredient, IngredientNutriment, IngredientSource, Nutriment
from app.schemas import IngredientCreate, IngredientRead
from app.auth import get_principal, require_admin

router = APIRouter(prefix="/ingredients", tags=["ingredients"], dependencies=[Depends(get_principal)])


@router.get("/", response_model=list[IngredientRead])
def list_ingredients(db: Session = Depends(get_db)):
    return db.query(Ingredient).order_by(Ingredient.nom).all()


# Doit être AVANT /{id} pour ne pas être capturé par le param dynamique
@router.get("/from_claude", dependencies=[Depends(require_admin)])
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
                    "unite": {"type": "string", "enum": ["g", "ml"], "description": "g pour les solides, ml pour les liquides (valeurs alors pour 100 ml)"},
                    "quantite_defaut": {"type": "number", "description": "Poids en g (ou volume en ml pour un liquide) d'une unité typique : 130 pour une pomme, 250 pour un verre de jus. Null si pas d'unité naturelle."},
                    "duree_conservation": {"type": "integer", "description": "Durée de conservation typique en jours après achat, dans les conditions habituelles (frigo pour le frais, placard pour le sec)"},
                    "regime": {"type": "string", "enum": ["vegan", "vegetarien", "non_vegetarien"], "description": "vegan : aucun produit animal ; vegetarien : produits laitiers, œufs ou miel mais ni viande ni poisson ; non_vegetarien : viande, poisson, gélatine, présure animale…"},
                    "nova": {"type": "integer", "enum": [1, 2, 3, 4], "description": "Groupe NOVA : 1 brut ou peu transformé, 2 ingrédient culinaire (huile, sucre…), 3 transformé, 4 ultra-transformé"},
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

        prompt = (
            f"Donne-moi les valeurs nutritionnelles précises pour 100g de « {nom} ». "
            "Utilise les tables officielles (CIQUAL France ou USDA). "
            "Inclus les nutriments supplémentaires présents en quantité notable, en particulier ceux qui comptent "
            "dans une alimentation végétarienne. Utilise exactement ces noms et unités : "
            + ", ".join(f"{nom} ({unite})" for nom, _, unite, _ in off.NUTRIMENTS) + ". "
            "Pour les liquides (jus, lait, huile...) utilise 'ml' comme unité et donne les valeurs pour 100 ml."
        )
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            tools=[tool],
            tool_choice={"type": "any"},
            messages=[{"role": "user", "content": prompt}],
        )

        for block in response.content:
            if block.type == "tool_use":
                result = dict(block.input)
                # Trace complète : on sait plus tard quel modèle et quelle question ont produit ces valeurs
                result["raw_data"] = json.dumps({
                    "source": "claude",
                    "model": response.model,
                    "response_id": response.id,
                    "created_at": datetime.utcnow().isoformat() + "Z",
                    "prompt": prompt,
                    "stop_reason": response.stop_reason,
                    "usage": {
                        "input_tokens": response.usage.input_tokens,
                        "output_tokens": response.usage.output_tokens,
                    },
                    "tool_input": block.input,
                }, ensure_ascii=False)
                return result

        raise HTTPException(status_code=500, detail="Claude n'a pas retourné de données structurées")

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur Claude API : {str(e)}")


@router.get("/by_barcode/{code}", response_model=IngredientRead)
def ingredient_by_barcode(code: str, db: Session = Depends(get_db)):
    """Ingrédient du catalogue déjà créé depuis ce code-barre (EAN-13 et UPC-A comparés sans les zéros de tête)."""
    digits = code.strip().lstrip("0")
    if not digits:
        raise HTTPException(status_code=404, detail="Code-barre inconnu du catalogue")
    source = (db.query(IngredientSource)
              .filter(func.ltrim(IngredientSource.code_barre, "0") == digits)
              .order_by(IngredientSource.id.desc())
              .first())
    if not source:
        raise HTTPException(status_code=404, detail="Code-barre inconnu du catalogue")
    return source.ingredient


@router.get("/from_barcode", dependencies=[Depends(require_admin)])
def ingredient_from_barcode(code: str = Query(...)):
    try:
        # categories_tags_fr n'est renvoyé que s'il est demandé explicitement, en plus de "all"
        resp = http_requests.get(
            f"https://world.openfoodfacts.org/api/v2/product/{code}.json",
            params={"lc": "fr", "fields": "all,categories_tags_fr"},
            timeout=10,
            headers={"User-Agent": "Frigood/1.0 (contact: frigood@example.com)"},
        )
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"OpenFoodFacts injoignable : {str(e)}")

    if resp.status_code != 200:
        raise HTTPException(status_code=404, detail="Produit introuvable sur OpenFoodFacts")
    data = resp.json()
    if data.get("status") != 1:
        raise HTTPException(status_code=404, detail="Code-barres non trouvé sur OpenFoodFacts")

    result = off.parse(data.get("product") or {})
    result["code_barre"] = code
    result["raw_data"] = json.dumps(data, ensure_ascii=False)
    return result


@router.post("/enrich_from_sources", dependencies=[Depends(require_admin)])
def enrich_from_sources(db: Session = Depends(get_db)):
    """Complète les ingrédients scannés depuis le JSON OpenFoodFacts déjà stocké, sans rien écraser :
    Nutri-Score, Green-Score, NOVA, régime et nutriments manquants."""
    nutriments_by_name = {n.nom.lower(): n for n in db.query(Nutriment)}
    ingredients_done = nutriments_added = 0
    sources = (db.query(IngredientSource)
               .filter(IngredientSource.source_type == "openfoodfacts", IngredientSource.raw_data.isnot(None))
               .order_by(IngredientSource.id.desc()))
    seen = set()
    for source in sources:
        if source.ingredient_id in seen:
            continue
        seen.add(source.ingredient_id)
        try:
            product = json.loads(source.raw_data).get("product") or {}
        except (ValueError, AttributeError):
            continue
        parsed = off.parse(product)
        ing = source.ingredient
        changed = False
        for field in ("nutriscore", "greenscore", "nova", "regime"):
            if getattr(ing, field) is None and parsed[field] is not None:
                setattr(ing, field, parsed[field])
                changed = True
        present = {link.nutriment.nom.lower() for link in ing.nutriments}
        for n in parsed["nutriments"]:
            if n["nom"].lower() in present:
                continue
            nutriment = nutriments_by_name.get(n["nom"].lower())
            if not nutriment:
                nutriment = Nutriment(nom=n["nom"], unite=n["unite"])
                db.add(nutriment)
                db.flush()
                nutriments_by_name[n["nom"].lower()] = nutriment
            db.add(IngredientNutriment(ingredient_id=ing.id, nutriment_id=nutriment.id, valeur=n["valeur"]))
            nutriments_added += 1
            changed = True
        ingredients_done += changed
    db.commit()
    return {"ingredients": ingredients_done, "nutriments_added": nutriments_added}


@router.get("/{id}", response_model=IngredientRead)
def get_ingredient(id: int, db: Session = Depends(get_db)):
    ingredient = db.get(Ingredient, id)
    if not ingredient:
        raise HTTPException(status_code=404, detail="Ingrédient introuvable")
    return ingredient


@router.post("/", response_model=IngredientRead, dependencies=[Depends(require_admin)])
def create_ingredient(data: IngredientCreate, db: Session = Depends(get_db)):
    source_fields = {"source_type", "source_code_barre", "source_raw_data"}
    ingredient_data = {k: v for k, v in data.model_dump().items() if k not in source_fields}
    ingredient = Ingredient(**ingredient_data)
    db.add(ingredient)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Un ingrédient nommé « {data.nom} » existe déjà")
    db.refresh(ingredient)

    if data.source_type:
        db.add(IngredientSource(
            ingredient_id=ingredient.id,
            source_type=data.source_type,
            code_barre=data.source_code_barre,
            raw_data=data.source_raw_data,
        ))
        db.commit()
        db.refresh(ingredient)

    return ingredient


@router.put("/{id}", response_model=IngredientRead, dependencies=[Depends(require_admin)])
def update_ingredient(id: int, data: IngredientCreate, db: Session = Depends(get_db)):
    ingredient = db.get(Ingredient, id)
    if not ingredient:
        raise HTTPException(status_code=404, detail="Ingrédient introuvable")
    for key, value in data.model_dump(exclude={"source_type", "source_code_barre", "source_raw_data"}).items():
        setattr(ingredient, key, value)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Un ingrédient nommé « {data.nom} » existe déjà")
    db.refresh(ingredient)
    return ingredient


@router.delete("/{id}", dependencies=[Depends(require_admin)])
def delete_ingredient(id: int, db: Session = Depends(get_db)):
    ingredient = db.get(Ingredient, id)
    if not ingredient:
        raise HTTPException(status_code=404, detail="Ingrédient introuvable")
    db.delete(ingredient)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"« {ingredient.nom} » est utilisé dans des recettes ou des repas : retire-le d'abord de ceux-ci")
    return {"message": "Ingrédient supprimé"}
