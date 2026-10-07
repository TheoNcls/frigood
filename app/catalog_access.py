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
    """Pas deux fois le même nom parmi ce que la personne voit (deux comptes peuvent avoir chacun leur « Nutella »)."""
    query = db.query(model.id).filter(func.lower(model.nom) == (nom or "").strip().lower())
    if exclude_id:
        query = query.filter(model.id != exclude_id)
    if visible(query, model, principal).first():
        raise HTTPException(status_code=400, detail=f"{label} nommé « {nom.strip()} » existe déjà")
