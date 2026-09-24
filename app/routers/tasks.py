import calendar
from datetime import date, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.auth import Principal, check_user_access, get_principal
from app.database import get_db
from app.models import Task, TaskCompletion, User
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
        (c.task_id, c.date): c.done_at
        for c in db.query(TaskCompletion).join(Task).filter(
            Task.user_id == user_id, TaskCompletion.date >= date_from, TaskCompletion.date <= date_to,
        )
    }
    result = []
    for t in tasks:
        for d in occurrences(t, date_from, date_to):
            result.append(TaskOccurrence(
                task_id=t.id, date=d, titre=t.titre, notes=t.notes, heure=t.heure, recurrence=t.recurrence,
                recurrence_fin=t.recurrence_fin, serie_debut=t.date,
                fait=(t.id, d) in done, done_at=done.get((t.id, d)),
            ))
    # Par jour, les tâches sans heure d'abord, puis par heure
    result.sort(key=lambda o: (o.date, o.heure or "", o.titre.lower()))
    return result


@router.post("/users/{user_id}/tasks/", response_model=TaskRead)
def create_task(user_id: int, data: TaskCreate, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    check_user_access(principal, user_id)
    if not db.get(User, user_id):
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    task = Task(user_id=user_id, **data.model_dump())
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@router.put("/tasks/{id}", response_model=TaskRead)
def update_task(id: int, data: TaskCreate, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    task = _own_task(db, id, principal)
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
    db.delete(_own_task(db, id, principal))
    db.commit()
    return {"message": "Tâche supprimée"}


@router.post("/tasks/{id}/done")
def set_done(id: int, data: TaskDone, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    task = _own_task(db, id, principal)
    if data.date not in occurrences(task, data.date, data.date):
        raise HTTPException(status_code=400, detail="Cette tâche n'a pas lieu ce jour-là")
    existing = db.query(TaskCompletion).filter_by(task_id=task.id, date=data.date).first()
    if data.fait and not existing:
        db.add(TaskCompletion(task_id=task.id, date=data.date))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()  # double clic : déjà cochée
    elif not data.fait and existing:
        db.delete(existing)
        db.commit()
    return {"task_id": task.id, "date": data.date, "fait": data.fait}
