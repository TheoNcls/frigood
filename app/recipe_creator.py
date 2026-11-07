"""Créateur de recettes : un brouillon (tout facultatif) complété par Claude ou par une autre IA (copier-coller)."""
import json
import unicodedata

from sqlalchemy.orm import Session

from app.auth import Principal
from app.catalog_access import visible
from app.coach import REGIME_LABELS, CoachError, claude_json, extract_json
from app.models import FridgeItem, Ingredient, User

MAX_CATALOG = 600     # ingrédients du catalogue envoyés à l'IA (noms seulement)
MAX_INGREDIENTS = 40

TYPES = [
    "Petit-déjeuner", "Déjeuner", "Dîner", "Plat principal", "Entrée", "Accompagnement", "Salade", "Soupe", "Bowl",
    "Snack", "Dessert", "Gâteau", "Pâtisserie", "Boisson", "Sauce", "Apéritif", "Batch cooking", "Pique-nique",
]

SYSTEM_PROMPT = """Tu es le chef cuisinier de Frigood, une application de nutrition et de frigo.
Tu écris en français. On te donne en JSON un brouillon de recette (tout y est facultatif : nom, types de recette,
portions, temps, description, ingrédients avec ou sans quantités, consignes), son régime alimentaire, la liste
des ingrédients de son catalogue et, si elle le demande, le contenu de son frigo.

Complète le brouillon pour en faire une recette réaliste, bonne et faisable :
- Garde ce qu'elle a fixé (nom, types, ingrédients, quantités, portions), sauf incohérence manifeste que tu signales
  dans « conseils ». Complète tout ce qui manque.
- Respecte strictement son régime alimentaire et ses consignes (temps, matériel, goûts, objectifs).
- Ingrédients : utilise en priorité ceux du catalogue (avec leur « catalogue_id ») ; si elle demande d'utiliser son
  frigo, privilégie ce qu'il contient, surtout ce qui périme bientôt. Un ingrédient absent du catalogue est possible :
  catalogue_id null, et ajoute-le dans « nouveaux_ingredients » avec ses valeurs nutritionnelles pour 100 g
  (ou 100 ml), d'après les tables officielles (CIQUAL, sinon USDA).
- Quantités pour la recette entière (toutes portions) : en grammes (g) ou millilitres (ml) ; « unite » pour ce qui
  se compte à la pièce (œuf, banane…), avec quantite = le nombre. « optionnel » : vrai pour un ingrédient au choix
  (une variante, une garniture), faux sinon.
- « description » : les étapes numérotées (1., 2., …), courtes et précises (temps de cuisson, feu, ustensiles).
- « conseils » : 2 à 4 puces Markdown courtes (variantes, conservation, ce que la recette apporte), sans titre.
- Les sels, épices et l'eau peuvent être omis des ingrédients s'ils ne sont pas dans le catalogue : cite-les dans
  les étapes."""


def norm(s: str) -> str:
    """Nom comparable : sans accents ni majuscules, ligatures dépliées (« Œuf » = « oeuf »)."""
    s = (s or "").lower().replace("œ", "oe").replace("æ", "ae")
    return unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode().strip()


def _num(v, lo: float = 0, hi: float = 100000, digits: int = 1) -> float | None:
    try:
        n = float(str(v).replace(",", ".")) if v is not None and v != "" else None
    except ValueError:
        return None
    return round(n, digits) if n is not None and lo <= n <= hi else None


def _text(v, max_len: int) -> str:
    return str(v or "").strip()[:max_len]


def catalog_for(db: Session, principal: Principal) -> list[Ingredient]:
    return visible(db.query(Ingredient), Ingredient, principal).order_by(Ingredient.nom).all()


# ── Contexte et texte envoyés à l'IA ──────────────────────────────────────────

def build_context(db: Session, user: User, draft: dict, catalog: list[Ingredient]) -> dict:
    by_id = {i.id: i for i in catalog}
    ingredients = []
    for it in draft.get("ingredients") or []:
        ing = by_id.get(it.get("ingredient_id")) if it.get("ingredient_id") else None
        nom = ing.nom if ing else it.get("nom")
        if not nom:
            continue
        ingredients.append({k: v for k, v in {
            "nom": nom, "catalogue_id": ing.id if ing else None,
            "quantite": it.get("quantite"),
            "mesure": "unite" if it.get("type_mesure") == "unite" else (ing.unite if ing else it.get("unite") or "g"),
            "optionnel": not it.get("par_defaut", True) or None,
        }.items() if v is not None})
    brouillon = {k: v for k, v in {
        "nom": draft.get("nom"), "types": draft.get("types") or None, "portions": draft.get("portions"),
        "temps_preparation_min": draft.get("temps_preparation"), "description": draft.get("description"),
        "ingredients": ingredients or None, "consignes": draft.get("consignes"),
    }.items() if v not in (None, "", [])}
    context = {
        "brouillon": brouillon,
        "regime": REGIME_LABELS.get(user.regime_alimentaire or "vegetarien", "végétarien"),
        # Compact : [id, nom, unité] (+ poids d'une unité quand on le connaît)
        "catalogue": [[i.id, i.nom, i.unite or "g"] + ([i.quantite_defaut] if i.quantite_defaut else []) for i in catalog[:MAX_CATALOG]],
    }
    if draft.get("utiliser_frigo"):
        frigo = []
        for f in (db.query(FridgeItem).filter(FridgeItem.user_id == user.id, FridgeItem.ingredient_id.isnot(None))
                  .order_by(FridgeItem.date_peremption)):
            ing = db.get(Ingredient, f.ingredient_id)
            if ing:
                frigo.append({"nom": ing.nom, "catalogue_id": ing.id, "quantite": f"{f.quantite:g} {ing.unite or 'g'}",
                              "peremption": f.date_peremption.isoformat() if f.date_peremption else None})
        context["frigo_a_utiliser_en_priorite"] = frigo
    return context


def user_message(context: dict) -> str:
    return ("Complète ma recette.\n\nVoici mon brouillon et mes données Frigood (JSON ; « catalogue » : "
            "[catalogue_id, nom, unité, poids d'une unité si connu]) :\n\n"
            + json.dumps(context, ensure_ascii=False, separators=(",", ":"), default=str))


_NUM = {"type": "number"}
_NULL_NUM = {"anyOf": [{"type": "number"}, {"type": "null"}]}


def response_schema() -> dict:
    return {
        "type": "object",
        "properties": {
            "nom": {"type": "string"},
            "types": {"type": "array", "items": {"type": "string"}, "description": "Types de recette (ex. Déjeuner, Salade)"},
            "portions": {"type": "integer"},
            "temps_preparation_min": {"type": "integer"},
            "description": {"type": "string", "description": "Étapes numérotées"},
            "ingredients": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "nom": {"type": "string"},
                        "catalogue_id": {"anyOf": [{"type": "integer"}, {"type": "null"}]},
                        "quantite": _NUM,
                        "mesure": {"type": "string", "enum": ["g", "ml", "unite"]},
                        "optionnel": {"type": "boolean"},
                    },
                    "required": ["nom", "catalogue_id", "quantite", "mesure", "optionnel"],
                    "additionalProperties": False,
                },
            },
            "nouveaux_ingredients": {
                "type": "array",
                "description": "Ingrédients absents du catalogue, valeurs pour 100 g ou 100 ml",
                "items": {
                    "type": "object",
                    "properties": {
                        "nom": {"type": "string"},
                        "categorie": {"type": "string"},
                        "unite": {"type": "string", "enum": ["g", "ml"]},
                        "calories": _NUM, "proteines": _NUM, "glucides": _NUM, "lipides": _NUM,
                        "quantite_defaut": {**_NULL_NUM, "description": "Poids d'une unité (g), ou null"},
                        "duree_conservation": {"type": "integer", "description": "Jours de conservation"},
                        "regime": {"type": "string", "enum": ["vegan", "vegetarien", "non_vegetarien"]},
                    },
                    "required": ["nom", "categorie", "unite", "calories", "proteines", "glucides", "lipides",
                                 "quantite_defaut", "duree_conservation", "regime"],
                    "additionalProperties": False,
                },
            },
            "conseils": {"type": "string", "description": "Markdown simple, quelques puces"},
        },
        "required": ["nom", "types", "portions", "temps_preparation_min", "description", "ingredients",
                     "nouveaux_ingredients", "conseils"],
        "additionalProperties": False,
    }


def external_prompt(context: dict) -> str:
    """Le même texte qu'envoyé à Claude, à coller dans une autre IA, avec le format de réponse attendu."""
    return (SYSTEM_PROMPT + "\n\n---\n\n" + user_message(context)
            + "\n\n---\n\nRéponds UNIQUEMENT avec un objet JSON, dans un bloc ```json, conforme à ce schéma JSON :\n"
            + json.dumps(response_schema(), ensure_ascii=False, separators=(",", ":")))


# ── Proposition (Claude ou autre IA) nettoyée pour le formulaire ──────────────

REGIMES = {"vegan", "vegetarien", "non_vegetarien"}


def _nutrition(n: dict) -> dict:
    unite = "ml" if str(n.get("unite") or "").lower() == "ml" else "g"
    regime = str(n.get("regime") or "").lower()
    out = {
        "categorie": _text(n.get("categorie"), 80) or None, "unite": unite,
        "calories": _num(n.get("calories"), 0, 1000), "proteines": _num(n.get("proteines"), 0, 100),
        "glucides": _num(n.get("glucides"), 0, 100), "lipides": _num(n.get("lipides"), 0, 100),
        "quantite_defaut": _num(n.get("quantite_defaut"), 0.1, 5000) or None,
        "duree_conservation": int(_num(n.get("duree_conservation"), 1, 3650, 0) or 7),
        "regime": regime if regime in REGIMES else None,
    }
    return out


def clean_proposal(data: dict, catalog: list[Ingredient]) -> dict:
    by_id = {i.id: i for i in catalog}
    by_name = {norm(i.nom): i for i in catalog}
    news = {norm(n.get("nom")): _nutrition(n) for n in data.get("nouveaux_ingredients") or []
            if isinstance(n, dict) and _text(n.get("nom"), 120)}
    ingredients, seen = [], set()
    for it in data.get("ingredients") or []:
        if not isinstance(it, dict):
            continue
        nom = _text(it.get("nom"), 120)
        cid = it.get("catalogue_id")
        ing = by_id.get(cid) if isinstance(cid, int) and not isinstance(cid, bool) else None
        ing = ing or by_name.get(norm(nom))   # même nom qu'un ingrédient du catalogue : c'est lui
        if not ing and not nom:
            continue
        key = ("id", ing.id) if ing else ("nom", norm(nom))
        if key in seen:
            continue
        seen.add(key)
        mesure = norm(str(it.get("mesure") or "g"))
        entry = {"quantite": _num(it.get("quantite"), 0.01, 100000, 2),
                 "type_mesure": "unite" if mesure in ("unite", "piece", "u") else "poids",
                 "par_defaut": not bool(it.get("optionnel"))}
        if ing:
            entry.update({"ingredient_id": ing.id, "nom": ing.nom})
        else:
            nutrition = news.get(norm(nom))
            entry.update({"ingredient_id": None, "nom": nom,
                          "unite": "ml" if mesure == "ml" or (nutrition or {}).get("unite") == "ml" else "g",
                          "nutrition": nutrition})
        ingredients.append(entry)
        if len(ingredients) >= MAX_INGREDIENTS:
            break
    portions = _num(data.get("portions"), 1, 50, 0)
    temps = _num(data.get("temps_preparation_min", data.get("temps_preparation")), 0, 1440, 0)
    return {
        "nom": _text(data.get("nom"), 120),
        "types": [t for t in (_text(x, 40) for x in data.get("types") or [] if isinstance(x, str)) if t][:6],
        "portions": int(portions) if portions else None,
        "temps_preparation": int(temps) if temps is not None else None,
        "description": _text(data.get("description"), 8000),
        "ingredients": ingredients,
        "conseils": _text(data.get("conseils"), 3000),
    }


def ask_claude(context: dict, catalog: list[Ingredient]) -> tuple[dict, dict]:
    data, usage = claude_json(SYSTEM_PROMPT, user_message(context), response_schema(), effort="medium", who="Le chef")
    return clean_proposal(data, catalog), usage


def parse_external(text: str, catalog: list[Ingredient]) -> dict:
    proposal = clean_proposal(extract_json(text, "la recette"), catalog)
    if not proposal["nom"] and not proposal["ingredients"] and not proposal["description"]:
        raise CoachError("Aucune recette trouvée dans la réponse (nom, ingrédients ou étapes)")
    return proposal
