from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app.auth import Principal, check_user_access, get_principal
from app.database import get_db
from app.garmin_body import apply_protein_target
from app.models import BodyComposition, FitnessMetric, User
from app.schemas import BodyCompositionCreate, BodyCompositionRead, FitnessMetricRead

router = APIRouter(tags=["body"], dependencies=[Depends(get_principal)])


@router.get("/users/{user_id}/body/", response_model=list[BodyCompositionRead])
def list_weigh_ins(user_id: int, date_from: date | None = Query(default=None), date_to: date | None = Query(default=None),
                   principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    check_user_access(principal, user_id)
    q = db.query(BodyComposition).filter(BodyComposition.user_id == user_id)
    if date_from:
        q = q.filter(BodyComposition.date >= date_from)
    if date_to:
        q = q.filter(BodyComposition.date <= date_to)
    return q.order_by(BodyComposition.date, BodyComposition.mesure_at, BodyComposition.id).all()


@router.post("/users/{user_id}/body/", response_model=BodyCompositionRead)
def add_weigh_in(user_id: int, data: BodyCompositionCreate, principal: Principal = Depends(get_principal),
                 db: Session = Depends(get_db)):
    """Pesée à la main : pour qui n'a pas de balance connectée."""
    check_user_access(principal, user_id)
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    row = BodyComposition(user_id=user_id, source="manuel", **data.model_dump())
    db.add(row)
    db.commit()
    apply_protein_target(db, user)
    db.refresh(row)
    return row


@router.delete("/body/{id}")
def delete_weigh_in(id: int, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    row = db.get(BodyComposition, id)
    if not row:
        raise HTTPException(status_code=404, detail="Pesée introuvable")
    check_user_access(principal, row.user_id)
    if row.source == "garmin":
        # Elle reviendrait à la prochaine synchro
        raise HTTPException(status_code=400, detail="Pesée de la balance Garmin : supprime-la dans Garmin Connect")
    user = db.get(User, row.user_id)
    db.delete(row)
    db.commit()
    apply_protein_target(db, user)
    return {"message": "Pesée supprimée"}


@router.get("/users/{user_id}/fitness/", response_model=list[FitnessMetricRead])
def list_fitness(user_id: int, date_from: date = Query(...), date_to: date = Query(...),
                 principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    check_user_access(principal, user_id)
    return (db.query(FitnessMetric)
            .filter(FitnessMetric.user_id == user_id, FitnessMetric.date >= date_from, FitnessMetric.date <= date_to)
            .order_by(FitnessMetric.date).all())
