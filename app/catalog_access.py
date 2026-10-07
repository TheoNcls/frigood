"""Qui voit et qui modifie les ingrédients et recettes du catalogue.

Chacun voit les éléments validés et ceux qu'il a créés ; il ne modifie ou supprime que les siens.
L'administration (et la clé de service) voit et modifie tout ; ce qu'elle crée est validé d'office.
"""
from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Query, Session

from app.auth import Principal


def visible(query: Query, model, principal: Principal, everything: bool = False) -> Query:
    """Éléments validés + ceux de la personne. `everything` (administration) : tout le catalogue."""
    if principal.is_service or (everything and principal.is_admin):
        return query
    return query.filter(or_(model.valide.is_(True), model.created_by == principal.user_id))


def is_visible(obj, principal: Principal) -> bool:
    return principal.is_admin or bool(obj.valide) or (principal.user_id is not None and obj.created_by == principal.user_id)


def can_edit(obj, principal: Principal) -> bool:
    return principal.is_admin or (principal.user_id is not None and obj.created_by == principal.user_id)


def check_can_edit(obj, principal: Principal, label: str):
    if not can_edit(obj, principal):
        raise HTTPException(status_code=403, detail=f"Tu ne peux modifier que {label} que tu as créés")


def check_name_free(db: Session, model, nom: str, principal: Principal, label: str, exclude_id: int | None = None):
    """Un nom n'existe qu'une fois (sans tenir compte des majuscules) : s'il est pris, on dit où le trouver."""
    clean = (nom or "").strip()
    query = db.query(model).filter(func.lower(model.nom) == clean.lower())
    if exclude_id:
        query = query.filter(model.id != exclude_id)
    existing = query.first()
    if not existing:
        return
    fem = label.startswith("Une")   # « Une recette » / « Un ingrédient »
    le, e = ("la", "e") if fem else ("le", "")
    if principal.user_id is not None and existing.created_by == principal.user_id and not principal.is_service:
        where = "dans tes ajouts"
    elif is_visible(existing, principal):
        where = f"dans le catalogue : utilise-{le} plutôt que d'en créer un{e} nouve{'lle' if fem else 'au'}"
    else:
        where = (f"et attend d'être validé{e} (ajouté{e} par quelqu'un d'autre) : choisis un nom plus précis, "
                 "par exemple avec la marque")
    raise HTTPException(status_code=400, detail=f"{label} « {existing.nom} » existe déjà {where}")
