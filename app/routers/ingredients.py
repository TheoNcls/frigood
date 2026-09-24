import os
import re
import json
from datetime import datetime
import requests as http_requests
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from app.database import get_db
from app.models import Ingredient, IngredientSource
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
                    "unite": {"type": "string", "description": "Unité principale (g pour solides, cl pour liquides)"},
                    "quantite_defaut": {"type": "number", "description": "Poids typique d'une unité en g (ex: 130 pour une pomme moyenne). Null si pas d'unité naturelle."},
                    "duree_conservation": {"type": "integer", "description": "Durée de conservation typique en jours après achat, dans les conditions habituelles (frigo pour le frais, placard pour le sec)"},
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
            "Inclus les principaux nutriments supplémentaires : fibres alimentaires, "
            "vitamines et minéraux importants pour cet aliment. "
            "Pour les liquides (jus, lait, huile...) utilise 'cl' comme unité."
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


def _name_with_brand(name: str, brands: str) -> str:
    """« Steak » + « Planted » → « Steak (Planted) » : première marque seulement, sauf si déjà dans le nom."""
    name = name.strip()
    brand = (brands or "").split(",")[0].strip()
    if brand.isupper() and len(brand) > 3:
        brand = brand.title()  # "DANONE" → "Danone"
    if not brand or brand.lower() in name.lower():
        return name
    return f"{name} ({brand})" if name else brand


def _serving_grams(product: dict) -> float | None:
    """Portion conseillée en g (ml assimilés à des g), depuis serving_quantity ou le texte serving_size."""
    unit = (product.get("serving_quantity_unit") or "g").strip().lower()
    try:
        qty = float(str(product.get("serving_quantity") or 0).replace(",", "."))
    except (ValueError, TypeError):
        qty = 0
    if qty > 0 and unit in ("g", "ml"):
        return round(qty, 1)
    # Sinon, premier nombre suivi de g / ml dans le texte, ex. "1 serving (140 g)" ou "30g"
    match = re.search(r"(\d+(?:[.,]\d+)?)\s*(g|ml)\b", product.get("serving_size") or "", re.IGNORECASE)
    if match:
        qty = float(match.group(1).replace(",", "."))
        return round(qty, 1) if qty > 0 else None
    return None


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

    product = data.get("product") or {}
    nutriments = product.get("nutriments") or {}

    # Calories : préférence kcal direct, sinon conversion depuis kJ
    calories = nutriments.get("energy-kcal_100g")
    if calories is None and nutriments.get("energy_100g"):
        try:
            calories = round(float(nutriments["energy_100g"]) / 4.184, 1)
        except (ValueError, TypeError):
            calories = None

    # Catégories en français, de la plus générale à la plus précise ; les tags non traduits gardent
    # un préfixe de langue ("de:Other") et sont écartés. Repli sur les tags anglais nettoyés.
    categories = [c.strip() for c in (product.get("categories_tags_fr") or []) if c and ":" not in c]
    if not categories:
        categories = [t.split(":", 1)[-1].replace("-", " ").strip() for t in (product.get("categories_tags") or [])]
        categories = [c for c in categories if c]
    categorie = categories[-1] if categories else ""

    # Nutriments supplémentaires
    extra_map = [
        ("Fibres", "fiber_100g", "g", 1),
        ("Sucres", "sugars_100g", "g", 1),
        ("Acides gras saturés", "saturated-fat_100g", "g", 1),
        ("Sel", "salt_100g", "g", 1),
        ("Sodium", "sodium_100g", "mg", 1000),
        ("Calcium", "calcium_100g", "mg", 1000),
        ("Fer", "iron_100g", "mg", 1000),
        ("Vitamine C", "vitamin-c_100g", "mg", 1000),
    ]
    nutriments_list = []
    for nom_nut, key, unite_nut, mult in extra_map:
        val = nutriments.get(key)
        if val is not None:
            try:
                nutriments_list.append({"nom": nom_nut, "unite": unite_nut, "valeur": round(float(val) * mult, 2)})
            except (ValueError, TypeError):
                pass

    def _f(key):
        v = nutriments.get(key)
        try:
            return round(float(v), 2) if v is not None else None
        except (ValueError, TypeError):
            return None

    # Description : generic_name + marque + quantité
    parts = []
    generic = product.get("generic_name_fr") or product.get("generic_name") or ""
    if generic:
        parts.append(generic)
    brand = product.get("brands") or ""
    if brand:
        parts.append(brand)
    quantity = product.get("quantity") or ""
    if quantity:
        parts.append(quantity)
    serving_size = (product.get("serving_size") or "").strip()
    if serving_size:
        parts.append(f"portion : {serving_size}")
    description = " — ".join(parts)

    return {
        "nom": _name_with_brand(product.get("product_name_fr") or product.get("product_name") or "", brand),
        "description": description,
        "categorie": categorie,
        "categories": list(reversed(categories)),
        "calories": calories,
        "proteines": _f("proteins_100g"),
        "glucides": _f("carbohydrates_100g"),
        "lipides": _f("fat_100g"),
        "unite": "g",
        "quantite_defaut": _serving_grams(product),
        "duree_conservation": 7,
        "nutriments": nutriments_list,
        "code_barre": code,
        "raw_data": json.dumps(data, ensure_ascii=False),
    }


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
