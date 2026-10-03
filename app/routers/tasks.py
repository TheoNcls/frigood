import json
import calendar
from datetime import date, datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.auth import Principal, check_user_access, get_principal
from app.database import get_db
from app.garmin_service import GarminSessionExpired, login_with_tokens, save_tokens
from app.garmin_workouts import is_running_task, remove_task, send_task
from app.models import Activity, ActivityType, Task, TaskCompletion, User
from app.push_service import now_local
from app.schemas import TaskCreate, TaskDone, TaskOccurrence, TaskRead

router = APIRouter(tags=["tasks"], dependencies=[Depends(get_principal)])

MAX_RANGE_DAYS = 400


def _add_months(d: date, months: int, day: int) -> date:
    """Même jour du mois `months` mois plus tard, ramené au dernier jour si le mois est plus court (31 → 30, 28…)."""
    m = d.month - 1 + months
    year, month = d.year + m // 12, m % 12 + 1
    return date(year, month, min(day, calendar.monthrange(year, month)[1]))


def occurrences(task: Task, start: date, end: date) -> list[date]:
    """Dates de la tâche comprises entre start et end inclus."""
    last = min(end, task.recurrence_fin) if task.recurrence_fin else end
    if task.date > last:
        return []
    if not task.recurrence:
        return [task.date] if start <= task.date <= last else []
    if task.recurrence in ("daily", "weekly"):
        step = 1 if task.recurrence == "daily" else 7
        # Première occurrence >= start, sans parcourir toute la série depuis sa création
        skip = max(0, -(-(start - task.date).days // step)) if start > task.date else 0
        d = task.date + timedelta(days=skip * step)
        out = []
        while d <= last:
            out.append(d)
            d += timedelta(days=step)
        return out
    out = []
    months = 0
    if start > task.date:
        months = max(0, (start.year - task.date.year) * 12 + start.month - task.date.month - 1)
    while True:
        d = _add_months(task.date, months, task.date.day)
        if d > last:
            return out
        if d >= start:
            out.append(d)
        months += 1


def sport_activities(db: Session, user_id: int, tasks: list[Task], start: date, end: date) -> dict[tuple[int, date], int]:
    """(type d'activité, jour) -> id de la première activité, pour les types utilisés par des tâches sportives."""
    type_ids = {t.activity_type_id for t in tasks if t.activity_type_id}
    if not type_ids:
        return {}
    found: dict[tuple[int, date], int] = {}
    for a in (db.query(Activity)
              .filter(Activity.user_id == user_id, Activity.activity_type_id.in_(type_ids),
                      Activity.date >= start, Activity.date <= end)
              .order_by(Activity.id)):
        found.setdefault((a.activity_type_id, a.date), a.id)
    return found


def _statut(c: TaskCompletion | None) -> dict:
    if c is None:
        return {"statut": None, "fait": False, "done_at": None}
    return {"statut": c.statut, "fait": c.statut == "fait", "done_at": c.done_at}


def _check_type(db: Session, data: TaskCreate):
    if data.activity_type_id is not None and not db.get(ActivityType, data.activity_type_id):
        raise HTTPException(status_code=400, detail="Type d'activité inconnu")


def _own_task(db: Session, id: int, principal: Principal) -> Task:
    task = db.get(Task, id)
    if not task:
        raise HTTPException(status_code=404, detail="Tâche introuvable")
    check_user_access(principal, task.user_id)
    return task


@router.get("/users/{user_id}/tasks/", response_model=list[TaskOccurrence])
def list_occurrences(
    user_id: int,
    date_from: date = Query(...),
    date_to: date = Query(...),
    principal: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    check_user_access(principal, user_id)
    if date_to < date_from:
        raise HTTPException(status_code=400, detail="date_to doit être après date_from")
    if (date_to - date_from).days > MAX_RANGE_DAYS:
        raise HTTPException(status_code=400, detail=f"Période limitée à {MAX_RANGE_DAYS} jours")

    tasks = db.query(Task).filter(Task.user_id == user_id, Task.date <= date_to).all()
    done = {
        (c.task_id, c.date): c
        for c in db.query(TaskCompletion).join(Task).filter(
            Task.user_id == user_id, TaskCompletion.date >= date_from, TaskCompletion.date <= date_to,
        )
    }
    sport = sport_activities(db, user_id, tasks, date_from, date_to)
    result = []
    for t in tasks:
        for d in occurrences(t, date_from, date_to):
            completion = done.get((t.id, d))
            activity_id = sport.get((t.activity_type_id, d)) if t.activity_type_id else None
            # Un choix manuel (faite / pas faite) reste prioritaire sur la validation par l'activité
            statut = _statut(completion) if completion or not activity_id else {"statut": "fait", "fait": True, "done_at": None}
            result.append(TaskOccurrence(
                task_id=t.id, date=d, titre=t.titre, notes=t.notes, heure=t.heure, recurrence=t.recurrence,
                recurrence_fin=t.recurrence_fin, serie_debut=t.date, important=bool(t.important),
                activity_type_id=t.activity_type_id, activity_type_nom=t.activity_type.nom if t.activity_type else None,
                par_coach=bool(t.par_coach),
                seance=json.loads(t.seance) if t.seance else None,
                garmin_envoye=bool(t.garmin_workout_id),
                auto=bool(activity_id and not completion), activity_id=activity_id,
                **statut,
            ))
    # Par jour, les tâches sans heure d'abord, puis par heure
    result.sort(key=lambda o: (o.date, o.heure or "", o.titre.lower()))
    return result


@router.post("/users/{user_id}/tasks/", response_model=TaskRead)
def create_task(user_id: int, data: TaskCreate, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    check_user_access(principal, user_id)
    if not db.get(User, user_id):
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    _check_type(db, data)
    task = Task(user_id=user_id, **data.model_dump())
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@router.put("/tasks/{id}", response_model=TaskRead)
def update_task(id: int, data: TaskCreate, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    task = _own_task(db, id, principal)
    _check_type(db, data)
    for key, value in data.model_dump().items():
        setattr(task, key, value)
    # Les coches qui ne correspondent plus à une occurrence (date ou récurrence changée) sont retirées
    valid_end = max((c.date for c in task.completions), default=task.date)
    kept = set(occurrences(task, task.date, valid_end))
    for c in list(task.completions):
        if c.date not in kept:
            db.delete(c)
    db.commit()
    db.refresh(task)
    return task


@router.delete("/tasks/{id}")
def delete_task(id: int, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    task = _own_task(db, id, principal)
    if task.garmin_workout_id:
        # Séance envoyée sur la montre : on la retire aussi de Garmin (sans bloquer la suppression)
        try:
            api = login_with_tokens(task.user, db)
            remove_task(api, db, task)
        except Exception:
            db.rollback()
    db.delete(task)
    db.commit()
    return {"message": "Tâche supprimée"}


def _garmin_api(db: Session, task: Task):
    user = task.user
    if not user.garmin_tokens:
        raise HTTPException(status_code=400, detail="Connecte d'abord Garmin dans le Profil")
    try:
        return login_with_tokens(user, db)
    except GarminSessionExpired:
        raise HTTPException(status_code=401, detail="SESSION_GARMIN_EXPIREE")


def _garmin_error(e: Exception):
    message = str(e)
    if any(k in message for k in ("429", "Cloudflare", "Too Many")):
        raise HTTPException(status_code=429, detail="GARMIN_BLOQUE")
    raise HTTPException(status_code=502, detail=f"Garmin a refusé la séance : {message[:300]}")


@router.post("/tasks/{id}/garmin")
def send_to_garmin(id: int, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """Crée la séance (course à pied) dans Garmin Connect et la programme au jour de la tâche."""
    task = _own_task(db, id, principal)
    if not task.seance or not is_running_task(task):
        raise HTTPException(status_code=400, detail="Seules les séances de course détaillées peuvent être envoyées pour l'instant")
    if task.recurrence:
        raise HTTPException(status_code=400, detail="Une tâche récurrente ne peut pas être envoyée sur la montre")
    if task.date < now_local().date():
        raise HTTPException(status_code=400, detail="Le jour de cette séance est passé")
    api = _garmin_api(db, task)
    try:
        if task.garmin_workout_id:
            remove_task(api, db, task)  # renvoi : on remplace l'ancienne
        send_task(api, db, task)
        save_tokens(task.user, api, db)
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        _garmin_error(e)
    return {"message": "Séance programmée sur Garmin", "workout_id": task.garmin_workout_id}


@router.delete("/tasks/{id}/garmin")
def remove_from_garmin(id: int, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    task = _own_task(db, id, principal)
    if not task.garmin_workout_id:
        return {"message": "Pas de séance Garmin"}
    api = _garmin_api(db, task)
    try:
        remove_task(api, db, task)
        save_tokens(task.user, api, db)
    except Exception as e:
        db.rollback()
        _garmin_error(e)
    return {"message": "Séance retirée de Garmin"}


@router.post("/tasks/{id}/done")
def set_done(id: int, data: TaskDone, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    task = _own_task(db, id, principal)
    if data.date not in occurrences(task, data.date, data.date):
        raise HTTPException(status_code=400, detail="Cette tâche n'a pas lieu ce jour-là")
    existing = db.query(TaskCompletion).filter_by(task_id=task.id, date=data.date).first()
    if data.statut is None:
        if existing:
            db.delete(existing)
            db.commit()
    elif existing:
        if existing.statut != data.statut:
            existing.statut = data.statut
            existing.done_at = datetime.utcnow()
            db.commit()
    else:
        db.add(TaskCompletion(task_id=task.id, date=data.date, statut=data.statut))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()  # double clic : déjà enregistrée
    return {"task_id": task.id, "date": data.date, "statut": data.statut, "fait": data.statut == "fait"}
