"""Habitudes (piano, méditation, lecture…) : jours prévus dans la semaine, et ce qui a été fait chaque jour."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import Principal, check_user_access, get_principal
from app.database import get_db
from app.models import Habit, HabitLog, User
from app.push_service import now_local
from app.schemas import HabitCreate, HabitLogCreate, HabitLogRead, HabitRead, HabitUpdate

router = APIRouter(tags=["habits"], dependencies=[Depends(get_principal)])

MAX_HABITS = 50
MAX_RANGE_DAYS = 400


def _days_text(days: list[int]) -> str:
    return "".join(str(d) for d in days)


def _own_habit(db: Session, id: int, principal: Principal) -> Habit:
    habit = db.get(Habit, id)
    if not habit:
        raise HTTPException(status_code=404, detail="Habitude introuvable")
    check_user_access(principal, habit.user_id)
    return habit


@router.get("/users/{user_id}/habits/", response_model=list[HabitRead])
def list_habits(user_id: int, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """Les habitudes actives d'abord, puis celles en pause."""
    check_user_access(principal, user_id)
    return db.query(Habit).filter_by(user_id=user_id).order_by(Habit.active.desc(), Habit.id).all()


@router.post("/users/{user_id}/habits/", response_model=HabitRead)
def add_habit(user_id: int, data: HabitCreate, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    check_user_access(principal, user_id)
    if not db.get(User, user_id):
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    if db.query(Habit).filter_by(user_id=user_id).count() >= MAX_HABITS:
        raise HTTPException(status_code=400, detail=f"{MAX_HABITS} habitudes au maximum")
    habit = Habit(user_id=user_id, nom=data.nom, emoji=data.emoji, jours=_days_text(data.jours))
    db.add(habit)
    db.commit()
    db.refresh(habit)
    return habit


@router.put("/habits/{id}", response_model=HabitRead)
def update_habit(id: int, data: HabitUpdate, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """Renommer, changer les jours, mettre en pause / reprendre."""
    habit = _own_habit(db, id, principal)
    if data.nom is not None:
        habit.nom = data.nom
    if "emoji" in data.model_fields_set:
        habit.emoji = data.emoji
    if data.jours is not None:
        habit.jours = _days_text(data.jours)
    if data.active is not None:
        habit.active = data.active
    db.commit()
    db.refresh(habit)
    return habit


@router.delete("/habits/{id}")
def delete_habit(id: int, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """Supprime l'habitude et son historique (la mettre en pause garde l'historique)."""
    habit = _own_habit(db, id, principal)
    db.delete(habit)
    db.commit()
    return {"message": "Habitude supprimée"}


@router.get("/users/{user_id}/habit_logs/", response_model=list[HabitLogRead])
def list_logs(user_id: int, date_from: date = Query(...), date_to: date = Query(...),
              principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    check_user_access(principal, user_id)
    if (date_to - date_from).days > MAX_RANGE_DAYS:
        raise HTTPException(status_code=400, detail="Période trop longue")
    return (db.query(HabitLog).join(Habit)
            .filter(Habit.user_id == user_id, HabitLog.date >= date_from, HabitLog.date <= date_to)
            .order_by(HabitLog.date.desc(), HabitLog.id.desc()).all())


@router.post("/users/{user_id}/habit_logs/", response_model=HabitLogRead)
def mark_done(user_id: int, data: HabitLogCreate, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """Habitude faite tel jour (aujourd'hui, ou un jour passé oublié). Déjà cochée : rien ne change."""
    check_user_access(principal, user_id)
    habit = db.get(Habit, data.habit_id)
    if not habit or habit.user_id != user_id:
        raise HTTPException(status_code=404, detail="Habitude introuvable")
    if data.date > now_local().date():
        raise HTTPException(status_code=400, detail="Impossible de cocher un jour à venir")
    existing = db.query(HabitLog).filter_by(habit_id=habit.id, date=data.date).first()
    if existing:
        return existing
    log = HabitLog(habit_id=habit.id, date=data.date)
    db.add(log)
    try:
        db.commit()
    except IntegrityError:   # double clic : déjà enregistrée entre-temps
        db.rollback()
        return db.query(HabitLog).filter_by(habit_id=habit.id, date=data.date).one()
    db.refresh(log)
    return log


@router.delete("/habit_logs/{id}")
def undo(id: int, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """Annule une habitude cochée (erreur, mauvais jour…)."""
    log = db.get(HabitLog, id)
    if not log:
        raise HTTPException(status_code=404, detail="Introuvable")
    check_user_access(principal, log.habit.user_id)
    db.delete(log)
    db.commit()
    return {"message": "Annulé"}
