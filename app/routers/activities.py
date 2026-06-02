from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from datetime import date as date_type, datetime, timedelta
from app.database import get_db
from app.models import Activity, ActivityType, User, DailyStat
from app.schemas import ActivityCreate, ActivityRead, GarminCredentials, DailyStatRead
from app.auth import verify_api_key

router = APIRouter(tags=["activities"], dependencies=[Depends(verify_api_key)])


def _safe_int(v):
    try:
        return int(v) if v is not None else None
    except (ValueError, TypeError):
        return None


def _safe_float(v, decimals=1):
    try:
        return round(float(v), decimals) if v is not None else None
    except (ValueError, TypeError):
        return None


def _sec_to_h(seconds):
    if not seconds:
        return None
    val = round(seconds / 3600, 1)
    return val if val > 0 else None


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


@router.get("/users/{user_id}/daily_stats/", response_model=DailyStatRead | None)
def get_daily_stat(
    user_id: int,
    date: date_type = Query(...),
    db: Session = Depends(get_db),
):
    return db.query(DailyStat).filter_by(user_id=user_id, date=date).first()


@router.delete("/users/{user_id}/garmin_disconnect")
def garmin_disconnect(user_id: int, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    user.garmin_tokens = None
    db.commit()
    db.refresh(user)
    return {"message": "Garmin déconnecté"}


@router.post("/users/{user_id}/garmin_sync")
def garmin_sync(user_id: int, credentials: GarminCredentials, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")

    mfa_prompted = False

    def _mfa_fn():
        nonlocal mfa_prompted
        mfa_prompted = True
        return credentials.mfa_code or ""

    try:
        from garminconnect import Garmin

        if user.garmin_tokens and not credentials.email:
            try:
                api = Garmin()
                api.garth.loads(user.garmin_tokens)
                api.login()
            except Exception:
                user.garmin_tokens = None
                db.commit()
                raise HTTPException(status_code=401, detail="SESSION_GARMIN_EXPIREE")
        else:
            if not credentials.email or not credentials.password:
                raise HTTPException(status_code=400, detail="Email et mot de passe requis")
            api = Garmin(
                email=credentials.email,
                password=credentials.password,
                prompt_mfa=_mfa_fn,
            )
            try:
                api.login()
            except Exception as e:
                if mfa_prompted and not credentials.mfa_code:
                    raise HTTPException(status_code=422, detail="CODE_MFA_REQUIS")
                raise HTTPException(status_code=400, detail=f"Erreur Garmin : {str(e)}")
            try:
                user.garmin_tokens = api.garth.dumps()
                db.commit()
            except AttributeError:
                pass

        # ── Activités ──────────────────────────────────────────
        raw = api.get_activities(0, 50)
        all_types = db.query(ActivityType).all()

        def match_type(type_key: str) -> int | None:
            key = type_key.lower()
            for at in all_types:
                if key in at.nom.lower() or at.nom.lower() in key:
                    return at.id
            return None

        act_imported = act_skipped = 0
        for a in raw:
            garmin_id = str(a.get("activityId", ""))
            if not garmin_id:
                continue
            if db.query(Activity).filter_by(garmin_activity_id=garmin_id).first():
                act_skipped += 1
                continue
            date_str = (a.get("startTimeLocal") or "")[:10]
            try:
                activity_date = datetime.strptime(date_str, "%Y-%m-%d").date()
            except ValueError:
                continue
            type_key = a.get("activityType", {}).get("typeKey", "")
            duration_s = a.get("duration") or 0
            distance_m = a.get("distance") or 0
            db.add(Activity(
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
            ))
            act_imported += 1
        db.commit()

        # ── Données santé quotidiennes (7 derniers jours) ──────
        today = datetime.now().date()
        stats_imported = 0

        for i in range(7):
            day = today - timedelta(days=i)
            day_str = day.strftime("%Y-%m-%d")
            existing = db.query(DailyStat).filter_by(user_id=user_id, date=day).first()
            if existing and day < today:
                continue
            stat = existing or DailyStat(user_id=user_id, date=day)
            updated = False

            # get_stats — BPM repos, stress, steps, étages
            try:
                s = api.get_stats(day_str) or {}
                stat.bpm_repos = _safe_int(s.get("restingHeartRate"))
                stat.bpm_moy = _safe_int(s.get("averageHeartRate"))
                stat.bpm_min = _safe_int(s.get("minAvgHeartRate"))
                stat.bpm_max = _safe_int(s.get("maxAvgHeartRate"))
                sm = s.get("averageStressLevel", -1)
                stat.stress_moy = _safe_int(sm) if (sm or 0) >= 0 else None
                sx = s.get("maxStressLevel", -1)
                stat.stress_max = _safe_int(sx) if (sx or 0) >= 0 else None
                stat.steps = _safe_int(s.get("totalSteps"))
                stat.steps_goal = _safe_int(s.get("dailyStepGoal"))
                stat.etages = _safe_int(s.get("floorsAscended") or s.get("floorsAscendedInMeters"))
                updated = True
            except Exception:
                pass

            # get_sleep_data
            try:
                sleep = api.get_sleep_data(day_str) or {}
                dto = (sleep.get("dailySleepDTO") or {})
                stat.sommeil_total_h = _sec_to_h(dto.get("sleepTimeSeconds"))
                stat.sommeil_profond_h = _sec_to_h(dto.get("deepSleepSeconds"))
                stat.sommeil_leger_h = _sec_to_h(dto.get("lightSleepSeconds"))
                stat.sommeil_rem_h = _sec_to_h(dto.get("remSleepSeconds"))
                stat.sommeil_eveil_h = _sec_to_h(dto.get("awakeSleepSeconds"))
                # Score sommeil — plusieurs formats possibles selon le modèle Garmin
                score_val = None
                scores = dto.get("sleepScores") or {}
                overall = scores.get("overallScore")
                if isinstance(overall, dict):
                    score_val = _safe_int(overall.get("value"))
                elif overall is not None:
                    score_val = _safe_int(overall)
                if score_val is None:
                    total_sleep = scores.get("totalSleep")
                    if isinstance(total_sleep, dict):
                        score_val = _safe_int(total_sleep.get("value"))
                    elif total_sleep is not None:
                        score_val = _safe_int(total_sleep)
                if score_val is None:
                    score_val = _safe_int(dto.get("sleepScore") or sleep.get("sleepScore"))
                stat.sommeil_score = score_val
                for ts_key, attr in [
                    ("sleepStartTimestampLocal", "heure_coucher"),
                    ("sleepEndTimestampLocal", "heure_reveil"),
                ]:
                    ts = sleep.get(ts_key) or sleep.get(ts_key.replace("Local", "GMT"))
                    if ts:
                        setattr(stat, attr, datetime.fromtimestamp(ts / 1000).strftime("%H:%M"))
                updated = True
            except Exception:
                pass

            # get_body_battery
            try:
                bb = api.get_body_battery(day_str)
                if bb and isinstance(bb, list):
                    vals = [v[1] for v in bb if isinstance(v, (list, tuple)) and len(v) > 1 and v[1] is not None]
                    if vals:
                        stat.body_battery_max = max(vals)
                        stat.body_battery_min = min(vals)
                        updated = True
            except Exception:
                pass

            # get_respiration_data
            try:
                resp = api.get_respiration_data(day_str) or {}
                val = resp.get("avgWakingRespirationValue") or resp.get("avgTotalRespirationValue")
                if val:
                    stat.respiration_moy = _safe_float(val)
                    updated = True
            except Exception:
                pass

            # get_spo2_data
            try:
                spo2 = api.get_spo2_data(day_str) or {}
                val = spo2.get("averageSpO2") or spo2.get("averageValue")
                if val:
                    stat.spo2_moy = _safe_int(val)
                    updated = True
            except Exception:
                pass

            # get_hrv_data
            try:
                hrv = api.get_hrv_data(day_str) or {}
                summary = hrv.get("hrvSummary") or {}
                val = summary.get("lastNight") or summary.get("weeklyAvg")
                if val:
                    stat.hrv_moy = _safe_int(val)
                    updated = True
            except Exception:
                pass

            if updated:
                if not existing:
                    db.add(stat)
                stats_imported += 1

        db.commit()

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Erreur Garmin : {str(e)}")

    return {
        "imported": act_imported,
        "skipped": act_skipped,
        "stats_days": stats_imported,
    }
