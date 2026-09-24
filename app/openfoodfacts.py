"""Lecture d'un produit OpenFoodFacts (JSON de l'API v2) en champs d'ingrédient Frigood."""
import re

# (nom Frigood, clé OpenFoodFacts sans "_100g", unité Frigood, multiplicateur)
# OpenFoodFacts donne toutes les valeurs en grammes : 3.8e-07 g de B12 = 0,38 µg
NUTRIMENTS = [
    ("Fibres", "fiber", "g", 1),
    ("Sucres", "sugars", "g", 1),
    ("Acides gras saturés", "saturated-fat", "g", 1),
    ("Oméga-3", "omega-3-fat", "g", 1),
    ("Sel", "salt", "g", 1),
    ("Sodium", "sodium", "mg", 1_000),
    ("Calcium", "calcium", "mg", 1_000),
    ("Fer", "iron", "mg", 1_000),
    ("Zinc", "zinc", "mg", 1_000),
    ("Magnésium", "magnesium", "mg", 1_000),
    ("Potassium", "potassium", "mg", 1_000),
    ("Vitamine C", "vitamin-c", "mg", 1_000),
    ("Vitamine B12", "vitamin-b12", "µg", 1_000_000),
    ("Vitamine D", "vitamin-d", "µg", 1_000_000),
    ("Vitamine B9", "vitamin-b9", "µg", 1_000_000),
    ("Iode", "iodine", "µg", 1_000_000),
    ("Sélénium", "selenium", "µg", 1_000_000),
]


def _float(v, decimals=2):
    try:
        return round(float(v), decimals) if v is not None else None
    except (ValueError, TypeError):
        return None


def name_with_brand(name: str, brands: str) -> str:
    """« Steak » + « Planted » → « Steak (Planted) » : première marque seulement, sauf si déjà dans le nom."""
    name = name.strip()
    brand = (brands or "").split(",")[0].strip()
    if brand.isupper() and len(brand) > 3:
        brand = brand.title()  # "DANONE" → "Danone"
    if not brand or brand.lower() in name.lower():
        return name
    return f"{name} ({brand})" if name else brand


def unit(product: dict) -> str:
    """ml pour les boissons et autres liquides : OpenFoodFacts donne alors les valeurs pour 100 ml."""
    units = {(product.get(k) or "").strip().lower() for k in ("product_quantity_unit", "serving_quantity_unit")}
    if "ml" in units or product.get("nutrition_data_per") == "100ml":
        return "ml"
    return "g"


def serving(product: dict) -> float | None:
    """Portion conseillée en g (ml assimilés à des g), depuis serving_quantity ou le texte serving_size."""
    serving_unit = (product.get("serving_quantity_unit") or "g").strip().lower()
    try:
        qty = float(str(product.get("serving_quantity") or 0).replace(",", "."))
    except (ValueError, TypeError):
        qty = 0
    if qty > 0 and serving_unit in ("g", "ml"):
        return round(qty, 1)
    # Sinon, premier nombre suivi de g / ml dans le texte, ex. "1 serving (140 g)" ou "30g"
    match = re.search(r"(\d+(?:[.,]\d+)?)\s*(g|ml)\b", product.get("serving_size") or "", re.IGNORECASE)
    if match:
        qty = float(match.group(1).replace(",", "."))
        return round(qty, 1) if qty > 0 else None
    return None


def nutriments(product: dict) -> list[dict]:
    values = product.get("nutriments") or {}
    found = []
    for nom, key, nut_unit, mult in NUTRIMENTS:
        raw = values.get(f"{key}_100g")
        if raw is None and key == "vitamin-b9":
            raw = values.get("folates_100g")
        v = _float(raw, 12)
        if v is not None:
            found.append({"nom": nom, "unite": nut_unit, "valeur": round(v * mult, 3)})
    return found


def _clean_tag(tag: str) -> str:
    return tag.split(":", 1)[-1].replace("-", " ").strip()


def regime(product: dict) -> tuple[str | None, list[str]]:
    """(vegan | vegetarien | non_vegetarien | incertain | None, ingrédients en cause)."""
    tags = set(product.get("ingredients_analysis_tags") or [])
    labels = set(product.get("labels_tags") or [])
    analysis = product.get("ingredients_analysis") or {}

    def causes(key):
        return [_clean_tag(c) for c in analysis.get(key) or []]

    # Un label certifié l'emporte sur l'analyse automatique des ingrédients
    if "en:vegan" in labels:
        return "vegan", []
    if "en:vegetarian" in labels:
        return "vegetarien", []
    if "en:non-vegetarian" in tags:
        return "non_vegetarien", causes("en:non-vegetarian")
    if "en:vegan" in tags:
        return "vegan", []
    if "en:vegetarian" in tags:
        return "vegetarien", []
    if "en:maybe-vegetarian" in tags:
        return "incertain", causes("en:maybe-vegetarian")
    return None, []


def nutriscore(product: dict) -> str | None:
    grade = (product.get("nutriscore_grade") or "").strip().lower()
    return grade if grade in ("a", "b", "c", "d", "e") else None


def greenscore(product: dict) -> str | None:
    # Ex-Eco-Score : le champ garde souvent son ancien nom ; "not-applicable" pour l'eau, "unknown" sinon
    grade = (product.get("environmental_score_grade") or product.get("ecoscore_grade") or "").strip().lower()
    return grade if grade in ("a-plus", "a", "b", "c", "d", "e", "f") else None


def nova(product: dict) -> int | None:
    try:
        n = int(product.get("nova_group"))
    except (ValueError, TypeError):
        return None
    return n if 1 <= n <= 4 else None


def categories(product: dict) -> list[str]:
    """Catégories en français, de la plus précise à la plus générale ; repli sur les tags anglais nettoyés.
    Les tags non traduits gardent un préfixe de langue ("de:Other") et sont écartés."""
    cats = [c.strip() for c in (product.get("categories_tags_fr") or []) if c and ":" not in c]
    if not cats:
        cats = [c for c in (_clean_tag(t) for t in (product.get("categories_tags") or [])) if c]
    return list(reversed(cats))


def parse(product: dict) -> dict:
    values = product.get("nutriments") or {}
    calories = values.get("energy-kcal_100g")
    if calories is None and values.get("energy_100g"):
        calories = _float(float(values["energy_100g"]) / 4.184, 1)

    brand = product.get("brands") or ""
    parts = [
        product.get("generic_name_fr") or product.get("generic_name") or "",
        brand,
        product.get("quantity") or "",
    ]
    serving_size = (product.get("serving_size") or "").strip()
    if serving_size:
        parts.append(f"portion : {serving_size}")

    cats = categories(product)
    diet, causes = regime(product)
    return {
        "nom": name_with_brand(product.get("product_name_fr") or product.get("product_name") or "", brand),
        "description": " — ".join(p for p in parts if p),
        "categorie": cats[0] if cats else "",
        "categories": cats,
        "calories": _float(calories),
        "proteines": _float(values.get("proteins_100g")),
        "glucides": _float(values.get("carbohydrates_100g")),
        "lipides": _float(values.get("fat_100g")),
        "unite": unit(product),
        "quantite_defaut": serving(product),
        "duree_conservation": 7,
        "nutriscore": nutriscore(product),
        "greenscore": greenscore(product),
        "nova": nova(product),
        "regime": diet,
        "regime_causes": causes,
        "nutriments": nutriments(product),
    }
