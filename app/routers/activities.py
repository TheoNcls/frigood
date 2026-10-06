import json
import logging
import threading
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import date as date_type, datetime, timedelta
from app.database import get_db
from app.models import Activity, GarminIgnoredActivity, User, DailyStat
from app.schemas import ActivityCreate, ActivityRead, GarminAutoSettings, GarminCredentials, GarminTokens, DailyStatRead, UserRead
from app.auth import Principal, get_principal, check_user_access
from app import garmin_auto
from app.push_service import now_local
from app.garmin_body import recompute_body_fitness
from app.garmin_service import (
    MAX_HISTORY_DAYS, GarminSessionExpired, activity_details, login_with_tokens, recompute_days, run_sync, save_tokens,
)

router = APIRouter(tags=["activities"], dependencies=[Depends(get_principal)])
log = logging.getLogger("frigood.garmin_open")

OPEN_SYNC_AFTER = timedelta(hours=2)      # à l'ouverture : synchro si la dernière date de plus de 2 h
OPEN_RETRY_AFTER = timedelta(minutes=30)  # et pas plus d'un essai toutes les 30 min (échec, plusieurs appareils…)
_open_lock = threading.Lock()
_open_running: set[int] = set()


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
    if activity.garmin_activity_id:
        # Sinon la prochaine synchro la réimporterait
        known = db.query(GarminIgnoredActivity).filter_by(
            user_id=activity.user_id, garmin_activity_id=activity.garmin_activity_id).first()
        if not known:
            db.add(GarminIgnoredActivity(user_id=activity.user_id, garmin_activity_id=activity.garmin_activity_id))
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


@router.put("/users/{user_id}/garmin_auto", response_model=UserRead)
def garmin_auto_settings(user_id: int, data: GarminAutoSettings, principal: Principal = Depends(get_principal),
                         db: Session = Depends(get_db)):
    """Active / règle la synchro automatique du matin pour ce compte."""
    check_user_access(principal, user_id)
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    if data.heure != user.garmin_auto_heure or data.enabled != user.garmin_auto_sync:
        # Nouveau réglage : on repart de zéro (une nouvelle heure plus tard dans la journée compte dès aujourd'hui)
        user.garmin_auto_date = None
        user.garmin_auto_tries = 0
        user.garmin_auto_next_at = None
        user.garmin_auto_status = None
    user.garmin_auto_sync = data.enabled
    user.garmin_auto_heure = data.heure
    db.commit()
    db.refresh(user)
    return user


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
        return run_sync(api, db, user, today, history_days)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Erreur Garmin : {str(e)}")


@router.post("/users/{user_id}/garmin_sync_open")
def garmin_sync_on_open(user_id: int, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """À l'ouverture de l'appli : synchro si la dernière date de plus de 2 h.
    Uniquement avec la session enregistrée (jamais de mot de passe), et jamais si Garmin vient de bloquer le serveur."""
    check_user_access(principal, user_id)
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    if not user.garmin_tokens:
        return {"status": "non_connecte"}
    now = datetime.utcnow()
    if user.garmin_last_sync_at and now - user.garmin_last_sync_at < OPEN_SYNC_AFTER:
        return {"status": "a_jour"}
    if (user.garmin_open_try_at and now - user.garmin_open_try_at < OPEN_RETRY_AFTER) or garmin_auto.blocked_now():
        return {"status": "attente"}
    with _open_lock:
        if user_id in _open_running:
            return {"status": "en_cours"}
        _open_running.add(user_id)
    try:
        user.garmin_open_try_at = now
        db.commit()
        try:
            api = login_with_tokens(user, db)
            res = run_sync(api, db, user, now_local().date(), auto=True)
        except GarminSessionExpired:
            return {"status": "session_expiree"}
        except Exception as e:
            message = str(e)[:200]
            if garmin_auto.is_blocked_error(message):
                garmin_auto.block()
            log.warning("Synchro Garmin à l'ouverture échouée (compte %s) : %s", user_id, message)
            return {"status": "erreur"}
        return {"status": "ok", "imported": res["imported"], "stats_days": res["stats_days"]}
    finally:
        with _open_lock:
            _open_running.discard(user_id)


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
    save_tokens(user, api, db)
    return {"message": "Session Garmin importée"}


@router.post("/users/{user_id}/garmin_recompute")
def garmin_recompute(user_id: int, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """Recalcule les données santé depuis les JSON Garmin déjà stockés, sans appeler Garmin."""
    check_user_access(principal, user_id)
    days, typed = recompute_days(db, user_id)
    weigh, fitness = recompute_body_fitness(db, user_id)
    return {"stats_days": days, "activities_typed": typed, "weigh_ins": weigh, "fitness_days": fitness}


def _garmin_login(user: User, credentials: GarminCredentials, db: Session):
    mfa_prompted = False

    def _mfa_fn():
        nonlocal mfa_prompted
        mfa_prompted = True
        return credentials.mfa_code or ""

    from garminconnect import Garmin

    if user.garmin_tokens and not credentials.email:
        try:
            return login_with_tokens(user, db)
        except GarminSessionExpired:
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
    save_tokens(user, api, db)
    return api
