import json
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import Activity, ActivityType, DailyStat

BATCH_DAYS = 30            # jours de santé traités par appel (≈ 6 requêtes Garmin par jour)
DEFAULT_DAYS = 7           # fenêtre minimale d'une synchronisation normale
MAX_CATCHUP_DAYS = 30      # rattrapage automatique depuis la dernière journée complète
MAX_HISTORY_DAYS = 365
MAX_CONSECUTIVE_FAILURES = 3

DAY_ENDPOINTS = [
    ("stats", "get_stats"),
    ("sleep", "get_sleep_data"),
    ("body_battery", "get_body_battery"),
    ("respiration", "get_respiration_data"),
    ("spo2", "get_spo2_data"),
    ("hrv", "get_hrv_data"),
]


def _int(v):
    try:
        return int(v) if v is not None else None
    except (ValueError, TypeError):
        return None


def _float(v, decimals=1):
    try:
        return round(float(v), decimals) if v is not None else None
    except (ValueError, TypeError):
        return None


def _hours(seconds):
    val = _float((seconds or 0) / 3600)
    return val if val else None


def _value(v):
    """Garmin renvoie selon les modèles un nombre ou {"value": nombre}."""
    return _int(v.get("value")) if isinstance(v, dict) else _int(v)


def is_complete(stat_date: date, synced_at: datetime | None) -> bool:
    # synced_at est en UTC : en France, une date UTC postérieure au jour garantit que la journée locale est finie
    return synced_at is not None and synced_at.date() > stat_date


# ── Extraction : JSON brut Garmin → colonnes de daily_stats ────────────────────

def _apply_stats(stat: DailyStat, s: dict):
    stat.bpm_repos = _int(s.get("restingHeartRate"))
    stat.bpm_moy = _int(s.get("averageHeartRate"))
    stat.bpm_min = _int(s.get("minHeartRate") or s.get("minAvgHeartRate"))
    stat.bpm_max = _int(s.get("maxHeartRate") or s.get("maxAvgHeartRate"))
    # Garmin met -1 / -2 quand la montre n'a pas assez de mesures
    sm, sx = _int(s.get("averageStressLevel")), _int(s.get("maxStressLevel"))
    stat.stress_moy = sm if sm is not None and sm >= 0 else None
    stat.stress_max = sx if sx is not None and sx >= 0 else None
    stat.steps = _int(s.get("totalSteps"))
    stat.steps_goal = _int(s.get("dailyStepGoal"))
    stat.etages = _int(s.get("floorsAscended"))
    stat.body_battery_max = _int(s.get("bodyBatteryHighestValue"))
    stat.body_battery_min = _int(s.get("bodyBatteryLowestValue"))


def _apply_sleep(stat: DailyStat, sleep: dict):
    dto = sleep.get("dailySleepDTO") or {}
    stat.sommeil_total_h = _hours(dto.get("sleepTimeSeconds"))
    stat.sommeil_profond_h = _hours(dto.get("deepSleepSeconds"))
    stat.sommeil_leger_h = _hours(dto.get("lightSleepSeconds"))
    stat.sommeil_rem_h = _hours(dto.get("remSleepSeconds"))
    stat.sommeil_eveil_h = _hours(dto.get("awakeSleepSeconds"))
    scores = dto.get("sleepScores") or {}
    stat.sommeil_score = (
        _value(scores.get("overall"))
        or _value(scores.get("overallScore"))
        or _value(scores.get("totalSleep"))
        or _int(dto.get("sleepScore") or sleep.get("sleepScore"))
    )
    for key, attr in [("sleepStartTimestampLocal", "heure_coucher"), ("sleepEndTimestampLocal", "heure_reveil")]:
        ts = dto.get(key) or sleep.get(key)
        # Horodatage "local" exprimé en ms : on le lit en UTC pour ne pas le décaler une seconde fois
        setattr(stat, attr, datetime.fromtimestamp(ts / 1000, tz=timezone.utc).strftime("%H:%M") if ts else None)


def _apply_body_battery(stat: DailyStat, bb):
    # Complète seulement si get_stats n'a pas fourni les extrêmes
    if stat.body_battery_max is not None and stat.body_battery_min is not None:
        return
    days = bb if isinstance(bb, list) else [bb]
    values = []
    for d in days:
        points = d.get("bodyBatteryValuesArray") if isinstance(d, dict) else [d]
        for p in points or []:
            if isinstance(p, (list, tuple)) and len(p) >= 2 and isinstance(p[-1], (int, float)):
                values.append(p[-1])
    if values:
        stat.body_battery_max = max(values)
        stat.body_battery_min = min(values)


def _apply_respiration(stat: DailyStat, r: dict):
    stat.respiration_moy = _float(r.get("avgWakingRespirationValue") or r.get("avgSleepRespirationValue"))


def _apply_spo2(stat: DailyStat, s: dict):
    stat.spo2_moy = _int(s.get("averageSpO2") or s.get("avgSleepSpO2"))


def _apply_hrv(stat: DailyStat, h: dict):
    summary = h.get("hrvSummary") or {}
    stat.hrv_moy = _int(summary.get("lastNightAvg") or summary.get("lastNight") or summary.get("weeklyAvg"))


APPLIERS = {
    "stats": _apply_stats,
    "sleep": _apply_sleep,
    "body_battery": _apply_body_battery,
    "respiration": _apply_respiration,
    "spo2": _apply_spo2,
    "hrv": _apply_hrv,
}


def apply_day(stat: DailyStat, raw: dict):
    """Recalcule les colonnes à partir du JSON brut. Une section en erreur ne touche pas aux valeurs déjà connues."""
    errors = raw.get("errors") or {}
    for key, _ in DAY_ENDPOINTS:
        if key in errors:
            continue
        data = raw.get(key)
        try:
            APPLIERS[key](stat, data if data is not None else ({} if key != "body_battery" else []))
        except Exception:
            pass


# ── Récupération Garmin ─────────────────────────────────────────────────────

def fetch_day(api, day: date) -> tuple[dict, bool]:
    day_str = day.isoformat()
    raw: dict = {"date": day_str}
    ok = False
    for key, method in DAY_ENDPOINTS:
        try:
            raw[key] = getattr(api, method)(day_str)
            ok = True
        except Exception as e:
            raw.setdefault("errors", {})[key] = str(e)[:300]
    return raw, ok


def days_to_sync(db: Session, user_id: int, today: date, history_days: int | None) -> list[date]:
    """Jours manquants ou incomplets, du plus récent au plus ancien."""
    known = {d: synced for d, synced in db.query(DailyStat.date, DailyStat.synced_at).filter(DailyStat.user_id == user_id)}

    if history_days:
        start = today - timedelta(days=min(history_days, MAX_HISTORY_DAYS) - 1)
    else:
        complete = [d for d, synced in known.items() if is_complete(d, synced)]
        start = max(complete) + timedelta(days=1) if complete else today - timedelta(days=DEFAULT_DAYS - 1)
        start = max(start, today - timedelta(days=MAX_CATCHUP_DAYS - 1))
        start = min(start, today - timedelta(days=DEFAULT_DAYS - 1))

    days = [start + timedelta(days=i) for i in range((today - start).days + 1)]
    return [d for d in reversed(days) if d not in known or not is_complete(d, known[d])]


def sync_days(api, db: Session, user_id: int, days: list[date]) -> int:
    synced = failures = 0
    for day in days:
        raw, ok = fetch_day(api, day)
        if not ok:
            # Garmin ne répond plus (limite de requêtes, panne) : inutile d'insister
            failures += 1
            if failures >= MAX_CONSECUTIVE_FAILURES:
                break
            continue
        failures = 0
        stat = db.query(DailyStat).filter_by(user_id=user_id, date=day).first()
        if not stat:
            stat = DailyStat(user_id=user_id, date=day)
            db.add(stat)
        apply_day(stat, raw)
        stat.raw_data = json.dumps(raw, ensure_ascii=False, default=str)
        stat.synced_at = datetime.utcnow()
        db.commit()
        synced += 1
    return synced


# Noms français des types Garmin les plus courants ; les autres sont dérivés de la clé ("paddle_board" → "Paddle board")
GARMIN_TYPE_LABELS = {
    "running": "Course à pied",
    "trail_running": "Trail",
    "treadmill_running": "Course sur tapis",
    "track_running": "Course sur piste",
    "indoor_running": "Course en salle",
    "cycling": "Vélo",
    "road_biking": "Vélo de route",
    "mountain_biking": "VTT",
    "gravel_cycling": "Gravel",
    "indoor_cycling": "Vélo d'intérieur",
    "virtual_ride": "Vélo virtuel",
    "e_bike_fitness": "Vélo électrique",
    "walking": "Marche",
    "casual_walking": "Marche",
    "speed_walking": "Marche rapide",
    "hiking": "Randonnée",
    "swimming": "Natation",
    "lap_swimming": "Natation en piscine",
    "open_water_swimming": "Natation en eau libre",
    "strength_training": "Renforcement musculaire",
    "cardio": "Cardio",
    "indoor_cardio": "Cardio",
    "hiit": "HIIT",
    "yoga": "Yoga",
    "pilates": "Pilates",
    "breathwork": "Respiration",
    "elliptical": "Elliptique",
    "stair_climbing": "Escaliers",
    "indoor_rowing": "Rameur",
    "rowing": "Aviron",
    "tennis": "Tennis",
    "padel": "Padel",
    "badminton": "Badminton",
    "soccer": "Football",
    "basketball": "Basket",
    "golf": "Golf",
    "rock_climbing": "Escalade",
    "indoor_climbing": "Escalade en salle",
    "bouldering": "Bloc",
    "resort_skiing_snowboarding_ws": "Ski alpin",
    "cross_country_skiing_ws": "Ski de fond",
    "backcountry_skiing": "Ski de randonnée",
    "kayaking": "Kayak",
    "stand_up_paddleboarding": "Paddle",
    "surfing": "Surf",
    "fitness_equipment": "Fitness",
    "multi_sport": "Multisport",
    "triathlon": "Triathlon",
    "other": "Autre",
}


class TypeResolver:
    """Trouve (ou crée) le type d'activité correspondant à une clé Garmin, avec un cache par synchronisation."""

    def __init__(self, db: Session):
        self.db = db
        self.cache: dict[str, int] = {}

    def __call__(self, type_key: str | None) -> int | None:
        key = (type_key or "").strip().lower()
        if not key:
            return None
        if key in self.cache:
            return self.cache[key]
        at = self.db.query(ActivityType).filter(ActivityType.garmin_type_key == key).first()
        if not at:
            label = GARMIN_TYPE_LABELS.get(key) or key.replace("_", " ").capitalize()
            # Un type du même nom existe déjà (créé à la main) : on le rattache plutôt que de dupliquer
            at = self.db.query(ActivityType).filter(func.lower(ActivityType.nom) == label.lower()).first()
            if at is None:
                at = ActivityType(nom=label, garmin_type_key=key)
                self.db.add(at)
            elif at.garmin_type_key is None:
                at.garmin_type_key = key
            self.db.flush()
        self.cache[key] = at.id
        return at.id


def _type_key(a: dict) -> str | None:
    return (a.get("activityType") or {}).get("typeKey")


def sync_activities(db: Session, user_id: int, raw_activities: list[dict]) -> tuple[int, int]:
    resolve = TypeResolver(db)
    existing = {
        gid: (has_raw, type_id)
        for gid, has_raw, type_id in db.query(Activity.garmin_activity_id, Activity.raw_data.isnot(None), Activity.activity_type_id)
        .filter(Activity.user_id == user_id, Activity.garmin_activity_id.isnot(None))
    }
    imported = skipped = 0
    for a in raw_activities:
        garmin_id = str(a.get("activityId") or "")
        if not garmin_id:
            continue
        raw_json = json.dumps(a, ensure_ascii=False, default=str)
        if garmin_id in existing:
            # Déjà importée : on complète seulement ce qui manque (JSON brut, type)
            has_raw, type_id = existing[garmin_id]
            updates = {}
            if not has_raw:
                updates[Activity.raw_data] = raw_json
            if type_id is None and (new_type := resolve(_type_key(a))):
                updates[Activity.activity_type_id] = new_type
            if updates:
                db.query(Activity).filter_by(garmin_activity_id=garmin_id).update(updates)
            skipped += 1
            continue
        try:
            activity_date = datetime.strptime((a.get("startTimeLocal") or "")[:10], "%Y-%m-%d").date()
        except ValueError:
            continue
        duration_s = a.get("duration") or 0
        distance_m = a.get("distance") or 0
        db.add(Activity(
            user_id=user_id,
            date=activity_date,
            activity_type_id=resolve(_type_key(a)),
            source="garmin",
            garmin_activity_id=garmin_id,
            duree_min=int(duration_s / 60) if duration_s else None,
            calories=a.get("calories"),
            distance_km=round(distance_m / 1000, 2) if distance_m else None,
            freq_cardiaque_moy=_int(a.get("averageHR")),
            notes=a.get("activityName"),
            raw_data=raw_json,
        ))
        existing[garmin_id] = (True, 1)
        imported += 1
    db.commit()
    return imported, skipped


def recompute_days(db: Session, user_id: int) -> tuple[int, int]:
    """Réapplique l'extraction sur tous les JSON bruts stockés, sans appeler Garmin.
    Retourne (jours recalculés, activités auxquelles un type a été attribué)."""
    days = 0
    for stat in db.query(DailyStat).filter(DailyStat.user_id == user_id, DailyStat.raw_data.isnot(None)):
        try:
            apply_day(stat, json.loads(stat.raw_data))
            days += 1
        except (ValueError, TypeError):
            continue

    resolve = TypeResolver(db)
    typed = 0
    untyped = db.query(Activity).filter(
        Activity.user_id == user_id, Activity.activity_type_id.is_(None), Activity.raw_data.isnot(None),
    )
    for activity in untyped:
        try:
            type_id = resolve(_type_key(json.loads(activity.raw_data)))
        except (ValueError, TypeError):
            continue
        if type_id:
            activity.activity_type_id = type_id
            typed += 1
    db.commit()
    return days, typed
