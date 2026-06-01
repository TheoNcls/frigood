from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import date as date_type
from app.database import get_db
from app.models import MealLog, User
from app.schemas import MealLogCreate, MealLogRead
from app.auth import verify_api_key

router = APIRouter(tags=["meal_logs"], dependencies=[Depends(verify_api_key)])


@router.post("/users/{user_id}/meal_logs/", response_model=MealLogRead)
def add_meal_log(user_id: int, data: MealLogCreate, db: Session = Depends(get_db)):
    if not db.get(User, user_id):
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    log = MealLog(user_id=user_id, **data.model_dump())
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


@router.get("/users/{user_id}/meal_logs/", response_model=list[MealLogRead])
def list_meal_logs(
    user_id: int,
    date: date_type | None = Query(default=None),
    db: Session = Depends(get_db),
):
    query = db.query(MealLog).filter(MealLog.user_id == user_id)
    if date:
        query = query.filter(MealLog.date == date)
    return query.order_by(MealLog.id).all()


@router.delete("/meal_logs/{id}")
def delete_meal_log(id: int, db: Session = Depends(get_db)):
    log = db.get(MealLog, id)
    if not log:
        raise HTTPException(status_code=404, detail="Log introuvable")
    db.delete(log)
    db.commit()
    return {"message": "Repas supprimé"}
