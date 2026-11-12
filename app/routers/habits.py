"""Habitudes (piano, méditation, lecture…) : jours prévus dans la semaine, et ce qui a été fait chaque jour."""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import Principal, check_user_access, get_principal
from app.database import get_db
from app import push_service
from app.models import DailyRoutine, Habit, HabitLog, RoutineReminder, User
from app.push_service import now_local
from app.schemas import (
    HabitCreate, HabitLogCreate, HabitLogRead, HabitRead, HabitUpdate, RoutineCreate, RoutineRead, RoutineReminderIn, RoutineUpdate,
)

router = APIRouter(tags=["habits"], dependencies=[Depends(get_principal)])

MAX_HABITS = 50
MAX_ROUTINES = 20
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
    habit = Habit(user_id=user_id, nom=data.nom, emoji=data.emoji, jours=_days_text(data.jours),
                  objectif_semaine=data.objectif_semaine, rappel_heure=data.rappel_heure)
    db.add(habit)
    db.commit()
    db.refresh(habit)
    return habit


@router.put("/habits/{id}", response_model=HabitRead)
def update_habit(id: int, data: HabitUpdate, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """Renommer, changer les jours ou l'objectif, le rappel, mettre en pause / reprendre."""
    habit = _own_habit(db, id, principal)
    if data.nom is not None:
        habit.nom = data.nom
    if "emoji" in data.model_fields_set:
        habit.emoji = data.emoji
    if data.jours is not None:
        habit.jours = _days_text(data.jours)
    if data.active is not None:
        habit.active = data.active
    if "objectif_semaine" in data.model_fields_set:
        habit.objectif_semaine = data.objectif_semaine
    if "rappel_heure" in data.model_fields_set and data.rappel_heure != habit.rappel_heure:
        habit.rappel_heure = data.rappel_heure
        habit.rappel_envoye_le = None   # nouvelle heure : le rappel peut repartir aujourd'hui
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


# ── Habitudes journalières : rappels à heures fixes ───────────────────────────

def _own_routine(db: Session, id: int, principal: Principal) -> DailyRoutine:
    routine = db.get(DailyRoutine, id)
    if not routine:
        raise HTTPException(status_code=404, detail="Habitude journalière introuvable")
    check_user_access(principal, routine.user_id)
    return routine


def _set_reminders(routine: DailyRoutine, rappels: list[RoutineReminderIn]):
    """Remplace les rappels. Ceux dont l'heure est déjà passée aujourd'hui ne partiront que demain
    (pas de notification « en retard » juste après l'enregistrement)."""
    now = now_local()
    routine.rappels.clear()
    for r in sorted(rappels, key=lambda r: r.heure):
        routine.rappels.append(RoutineReminder(heure=r.heure, message=r.message,
                                               envoye_le=now.date() if r.heure <= now.strftime("%H:%M") else None))


@router.get("/users/{user_id}/routines/", response_model=list[RoutineRead])
def list_routines(user_id: int, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    check_user_access(principal, user_id)
    return db.query(DailyRoutine).filter_by(user_id=user_id).order_by(DailyRoutine.active.desc(), DailyRoutine.id).all()


@router.post("/users/{user_id}/routines/", response_model=RoutineRead)
def add_routine(user_id: int, data: RoutineCreate, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    check_user_access(principal, user_id)
    if not db.get(User, user_id):
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    if db.query(DailyRoutine).filter_by(user_id=user_id).count() >= MAX_ROUTINES:
        raise HTTPException(status_code=400, detail=f"{MAX_ROUTINES} habitudes journalières au maximum")
    routine = DailyRoutine(user_id=user_id, nom=data.nom, jours=_days_text(data.jours), active=data.active)
    _set_reminders(routine, data.rappels)
    db.add(routine)
    db.commit()
    db.refresh(routine)
    return routine


@router.put("/routines/{id}", response_model=RoutineRead)
def update_routine(id: int, data: RoutineUpdate, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    routine = _own_routine(db, id, principal)
    if data.nom is not None:
        routine.nom = data.nom
    if data.jours is not None:
        routine.jours = _days_text(data.jours)
    if data.active is not None:
        if data.active and not routine.active:
            # Remise en route : les rappels déjà passés aujourd'hui ne partent pas en retard
            now = now_local()
            for r in routine.rappels:
                if r.heure <= now.strftime("%H:%M"):
                    r.envoye_le = now.date()
        routine.active = data.active
    if data.rappels is not None:
        _set_reminders(routine, data.rappels)
    db.commit()
    db.refresh(routine)
    return routine


@router.delete("/routines/{id}")
def delete_routine(id: int, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    routine = _own_routine(db, id, principal)
    db.delete(routine)
    db.commit()
    return {"message": "Habitude journalière supprimée"}


@router.post("/routines/{id}/test")
def test_routine(id: int, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """Envoie tout de suite une notification d'essai sur les appareils où les notifications sont activées."""
    routine = _own_routine(db, id, principal)
    if not push_service.enabled():
        raise HTTPException(status_code=400, detail="Les notifications ne sont pas configurées sur le serveur")
    message = routine.rappels[0].message if routine.rappels else "Les rappels de cette habitude arriveront ainsi."
    sent = push_service.send_to_user(db, routine.user_id, {
        "title": f"🔔 {routine.nom} (essai)", "body": message, "url": "/habitudes", "tag": f"routine-test-{routine.id}"})
    return {"envoyes": sent}
