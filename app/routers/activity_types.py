from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from app.database import get_db
from app.models import ActivityType
from app.schemas import ActivityTypeCreate, ActivityTypeRead
from app.auth import verify_api_key

router = APIRouter(prefix="/activity_types", tags=["activity_types"], dependencies=[Depends(verify_api_key)])


@router.get("/", response_model=list[ActivityTypeRead])
def list_activity_types(db: Session = Depends(get_db)):
    return db.query(ActivityType).order_by(ActivityType.nom).all()


@router.post("/", response_model=ActivityTypeRead)
def create_activity_type(data: ActivityTypeCreate, db: Session = Depends(get_db)):
    at = ActivityType(**data.model_dump())
    db.add(at)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Le type « {data.nom} » existe déjà")
    db.refresh(at)
    return at


@router.put("/{id}", response_model=ActivityTypeRead)
def update_activity_type(id: int, data: ActivityTypeCreate, db: Session = Depends(get_db)):
    at = db.get(ActivityType, id)
    if not at:
        raise HTTPException(status_code=404, detail="Type d'activité introuvable")
    for key, value in data.model_dump().items():
        setattr(at, key, value)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Le type « {data.nom} » existe déjà")
    db.refresh(at)
    return at


@router.delete("/{id}")
def delete_activity_type(id: int, db: Session = Depends(get_db)):
    at = db.get(ActivityType, id)
    if not at:
        raise HTTPException(status_code=404, detail="Type d'activité introuvable")
    db.delete(at)
    db.commit()
    return {"message": "Type supprimé"}
