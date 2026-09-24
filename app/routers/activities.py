import json
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import date as date_type, datetime, timedelta
from app.database import get_db
from app.models import Activity, User, DailyStat
from app.schemas import ActivityCreate, ActivityRead, GarminCredentials, GarminTokens, DailyStatRead
from app.auth import Principal, get_principal, check_user_access
from app.garmin_service import (
    BATCH_DAYS, MAX_HISTORY_DAYS, activity_details, days_to_sync, recompute_days, sync_activities, sync_days,
)

router = APIRouter(tags=["activities"], dependencies=[Depends(get_principal)])


@router.post("/users/{user_id}/activities/", response_model=ActivityRead)
def add_activity(user_id: int, data: ActivityCreate, principal: Principal = Depends(get_principal),
                 db: Session = Depends(get_db)):
    check_user_access(principal, user_id)
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
    date_from: date_type | None = Query(default=None),
    date_to: date_type | None = Query(default=None),
    principal: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    check_user_access(principal, user_id)
    query = db.query(Activity).filter(Activity.user_id == user_id)
    if date:
        query = query.filter(Activity.date == date)
    if date_from:
        query = query.filter(Activity.date >= date_from)
    if date_to:
        query = query.filter(Activity.date <= date_to)
    return query.order_by(Activity.date.desc(), Activity.id.desc()).all()


@router.delete("/activities/{id}")
def delete_activity(id: int, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    activity = db.get(Activity, id)
    if not activity:
        raise HTTPException(status_code=404, detail="Activité introuvable")
    check_user_access(principal, activity.user_id)
    db.delete(activity)
    db.commit()
    return {"message": "Activité supprimée"}


@router.get("/activities/{id}/details")
def activity_detail(id: int, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """Détails lus dans le JSON Garmin déjà enregistré : aucun appel à Garmin."""
    activity = db.get(Activity, id)
    if not activity:
        raise HTTPException(status_code=404, detail="Activité introuvable")
    check_user_access(principal, activity.user_id)
    if not activity.raw_data:
        return {"disponible": False}
    try:
        raw = json.loads(activity.raw_data)
    except ValueError:
        return {"disponible": False}
    return {"disponible": True, **activity_details(raw)}


@router.get("/users/{user_id}/daily_stats/", response_model=DailyStatRead | None)
def get_daily_stat(
    user_id: int,
    date: date_type = Query(...),
    principal: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    check_user_access(principal, user_id)
    return db.query(DailyStat).filter_by(user_id=user_id, date=date).first()


@router.get("/users/{user_id}/daily_stats/range", response_model=list[DailyStatRead])
def list_daily_stats(
    user_id: int,
    date_from: date_type = Query(...),
    date_to: date_type = Query(...),
    principal: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    check_user_access(principal, user_id)
    return (db.query(DailyStat)
            .filter(DailyStat.user_id == user_id, DailyStat.date >= date_from, DailyStat.date <= date_to)
            .order_by(DailyStat.date)
            .all())


@router.delete("/users/{user_id}/garmin_disconnect")
def garmin_disconnect(user_id: int, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    check_user_access(principal, user_id)
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    user.garmin_tokens = None
    db.commit()
    db.refresh(user)
    return {"message": "Garmin déconnecté"}


@router.post("/users/{user_id}/garmin_sync")
def garmin_sync(
    user_id: int,
    credentials: GarminCredentials,
    history_days: int | None = Query(default=None, ge=1, le=MAX_HISTORY_DAYS),
    principal: Principal = Depends(get_principal),
    db: Session = Depends(get_db),
):
    """Synchronisation normale : rattrape depuis la dernière journée complète (30 jours max).
    Avec history_days : comble tous les trous sur cette période, par lots de 30 jours (rappeler tant que remaining_days > 0)."""
    check_user_access(principal, user_id)
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")

    api = _garmin_login(user, credentials, db)
    today = datetime.now().date()

    try:
        if history_days:
            start = today - timedelta(days=history_days - 1)
            raw_activities = api.get_activities_by_date(start.isoformat(), today.isoformat())
        else:
            raw_activities = api.get_activities(0, 50)
        if isinstance(raw_activities, dict):
            raw_activities = raw_activities.get("activities") or raw_activities.get("activityList") or []
        imported, skipped = sync_activities(db, user_id, raw_activities or [])

        todo = days_to_sync(db, user_id, today, history_days)
        batch = todo[:BATCH_DAYS]
        stats_days = sync_days(api, db, user_id, batch)
        _save_tokens(user, api, db)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Erreur Garmin : {str(e)}")

    return {
        "imported": imported,
        "skipped": skipped,
        "stats_days": stats_days,
        "remaining_days": len(todo) - stats_days,
    }


@router.post("/users/{user_id}/garmin_tokens")
def garmin_import_tokens(user_id: int, data: GarminTokens, principal: Principal = Depends(get_principal),
                         db: Session = Depends(get_db)):
    """Session Garmin obtenue depuis un autre appareil (scripts/garmin_login.py), quand Garmin bloque Railway."""
    check_user_access(principal, user_id)
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    raw = data.tokens.strip()
    try:
        if not json.loads(raw).get("di_refresh_token"):
            raise ValueError
    except (ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="Session invalide : colle tout le texte affiché par le script, accolades comprises")

    from garminconnect import Garmin
    api = Garmin()
    try:
        api.login(tokenstore=raw)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Garmin refuse cette session : {str(e)}")
    _save_tokens(user, api, db)
    return {"message": "Session Garmin importée"}


@router.post("/users/{user_id}/garmin_recompute")
def garmin_recompute(user_id: int, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """Recalcule les données santé depuis les JSON Garmin déjà stockés, sans appeler Garmin."""
    check_user_access(principal, user_id)
    days, typed = recompute_days(db, user_id)
    return {"stats_days": days, "activities_typed": typed}


def _garmin_login(user: User, credentials: GarminCredentials, db: Session):
    mfa_prompted = False

    def _mfa_fn():
        nonlocal mfa_prompted
        mfa_prompted = True
        return credentials.mfa_code or ""

    from garminconnect import Garmin

    if user.garmin_tokens and not credentials.email:
        try:
            # Les tokens doivent être passés à login() : chargés à part, login() redemanderait email et mot de passe
            api = Garmin()
            api.login(tokenstore=user.garmin_tokens)
            return api
        except Exception:
            user.garmin_tokens = None
            db.commit()
            raise HTTPException(status_code=401, detail="SESSION_GARMIN_EXPIREE")

    if not credentials.email or not credentials.password:
        raise HTTPException(status_code=400, detail="Email et mot de passe requis")
    api = Garmin(email=credentials.email, password=credentials.password, prompt_mfa=_mfa_fn)
    try:
        api.login()
    except Exception as e:
        if mfa_prompted and not credentials.mfa_code:
            raise HTTPException(status_code=422, detail="CODE_MFA_REQUIS")
        message = str(e)
        # Cloudflare filtre souvent les connexions par mot de passe venant de serveurs (Railway)
        if any(k in message for k in ("429", "Cloudflare", "403", "TooManyRequests")):
            raise HTTPException(status_code=429, detail="GARMIN_BLOQUE")
        raise HTTPException(status_code=400, detail=f"Erreur Garmin : {message}")
    _save_tokens(user, api, db)
    return api


def _save_tokens(user: User, api, db: Session):
    """Enregistre la session Garmin (JSON), y compris après un rafraîchissement automatique du token."""
    tokens = api.client.dumps()
    if tokens != user.garmin_tokens:
        user.garmin_tokens = tokens
        db.commit()
