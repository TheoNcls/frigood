from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import date as date_type, datetime
from app.database import get_db
from app.models import Activity, ActivityType, User
from app.schemas import ActivityCreate, ActivityRead, GarminCredentials
from app.auth import verify_api_key

router = APIRouter(tags=["activities"], dependencies=[Depends(verify_api_key)])


@router.post("/users/{user_id}/activities/", response_model=ActivityRead)
def add_activity(user_id: int, data: ActivityCreate, db: Session = Depends(get_db)):
    if not db.get(User, user_id):
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    activity = Activity(user_id=user_id, **data.model_dump())
    db.add(activity)
    db.commit()
    db.refresh(activity)
    return activity


@router.get("/users/{user_id}/activities/", response_model=list[ActivityRead])
def list_activities(
    user_id: int,
    date: date_type | None = Query(default=None),
    db: Session = Depends(get_db),
):
    query = db.query(Activity).filter(Activity.user_id == user_id)
    if date:
        query = query.filter(Activity.date == date)
    return query.order_by(Activity.date.desc(), Activity.id.desc()).all()


@router.delete("/activities/{id}")
def delete_activity(id: int, db: Session = Depends(get_db)):
    activity = db.get(Activity, id)
    if not activity:
        raise HTTPException(status_code=404, detail="Activité introuvable")
    db.delete(activity)
    db.commit()
    return {"message": "Activité supprimée"}


@router.post("/users/{user_id}/garmin_sync")
def garmin_sync(user_id: int, credentials: GarminCredentials, db: Session = Depends(get_db)):
    if not db.get(User, user_id):
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    try:
        from garminconnect import Garmin
        client = Garmin(email=credentials.email, password=credentials.password)
        client.login()
        raw_activities = client.get_activities(0, 50)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Erreur Garmin Connect : {str(e)}")

    all_types = db.query(ActivityType).all()

    def match_type(type_key: str) -> int | None:
        key = type_key.lower()
        for at in all_types:
            if key in at.nom.lower() or at.nom.lower() in key:
                return at.id
        return None

    imported = skipped = 0
    for a in raw_activities:
        garmin_id = str(a.get("activityId", ""))
        if not garmin_id:
            continue
        if db.query(Activity).filter_by(garmin_activity_id=garmin_id).first():
            skipped += 1
            continue

        date_str = (a.get("startTimeLocal") or "")[:10]
        try:
            activity_date = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            continue

        type_key = a.get("activityType", {}).get("typeKey", "")
        duration_s = a.get("duration") or 0
        distance_m = a.get("distance") or 0

        activity = Activity(
            user_id=user_id,
            date=activity_date,
            activity_type_id=match_type(type_key) if type_key else None,
            source="garmin",
            garmin_activity_id=garmin_id,
            duree_min=int(duration_s / 60) if duration_s else None,
            calories=a.get("calories"),
            distance_km=round(distance_m / 1000, 2) if distance_m else None,
            freq_cardiaque_moy=int(a["averageHR"]) if a.get("averageHR") else None,
            notes=a.get("activityName"),
        )
        db.add(activity)
        imported += 1

    db.commit()
    return {"imported": imported, "skipped": skipped}
