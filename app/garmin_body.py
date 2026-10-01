"""Balance connectée (composition corporelle) et indicateurs de forme Garmin.

Les réponses Garmin varient selon les modèles (balance, montre) : la lecture est défensive
(plusieurs noms de champs, unités en grammes ou en kg) et le JSON brut est conservé,
pour pouvoir tout relire plus tard sans rappeler Garmin.
"""
import json
from datetime import date, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models import BodyComposition, FitnessMetric, User

BODY_DEFAULT_DAYS = 30          # synchro normale : pesées des 30 derniers jours (1 seul appel)
FITNESS_REFRESH = timedelta(hours=3)  # indicateurs de forme : au plus un passage toutes les 3 h

# Statut d'entraînement Garmin (début de trainingStatusFeedbackPhrase) → libellé
TRAINING_STATUS_LABELS = {
    "PEAKING": "Pic de forme",
    "PRODUCTIVE": "Productif",
    "MAINTAINING": "Maintien",
    "RECOVERY": "Récupération",
    "UNPRODUCTIVE": "Improductif",
    "DETRAINING": "Désentraînement",
    "OVERREACHING": "Surmenage",
    "STRAINED": "Sous tension",
    "NO_STATUS": "Pas de statut",
}
READINESS_LABELS = {
    "PRIME": "Optimale",
    "HIGH": "Élevée",
    "MODERATE": "Modérée",
    "LOW": "Faible",
    "POOR": "Très faible",
}


def _num(v, decimals=1):
    try:
        return round(float(v), decimals) if v is not None and v != "" else None
    except (ValueError, TypeError):
        return None


def _int(v):
    n = _num(v, 0)
    return int(n) if n is not None else None


def _kg(v, threshold: float):
    """Garmin donne les masses en grammes ; certaines réponses déjà en kg."""
    n = _num(v, 3)
    if n is None or n <= 0:
        return None
    return round(n / 1000, 2) if n > threshold else round(n, 2)


def _find(obj, key):
    """Première valeur non nulle pour `key`, n'importe où dans le JSON."""
    if isinstance(obj, dict):
        if obj.get(key) is not None:
            return obj[key]
        for v in obj.values():
            found = _find(v, key)
            if found is not None:
                return found
    elif isinstance(obj, list):
        for v in obj:
            found = _find(v, key)
            if found is not None:
                return found
    return None


# ── Pesées ────────────────────────────────────────────────────────────────────

def parse_weigh_in(item: dict) -> dict | None:
    poids = _kg(item.get("weight"), 500)
    if not poids:
        return None
    measured = None
    ts = item.get("timestampGMT") or item.get("date")
    if isinstance(ts, (int, float)) and ts > 0:
        measured = datetime.fromtimestamp(ts / 1000, tz=timezone.utc).replace(tzinfo=None)
    day = item.get("calendarDate") or item.get("summaryDate")
    try:
        day = date.fromisoformat(str(day)[:10]) if day else (measured.date() if measured else None)
    except ValueError:
        day = measured.date() if measured else None
    if not day:
        return None
    return {
        "date": day,
        "mesure_at": measured,
        "poids_kg": poids,
        "imc": _num(item.get("bmi")),
        "masse_grasse_pct": _num(item.get("bodyFat")),
        "masse_musculaire_kg": _kg(item.get("muscleMass"), 300),
        "masse_osseuse_kg": _kg(item.get("boneMass"), 30),
        "eau_pct": _num(item.get("bodyWater")),
        "graisse_viscerale": _num(item.get("visceralFat")),
        "age_metabolique": _int(item.get("metabolicAge")),
    }


def weigh_in_items(raw) -> list[dict]:
    if isinstance(raw, list):
        return [x for x in raw if isinstance(x, dict)]
    if not isinstance(raw, dict):
        return []
    items = raw.get("dateWeightList")
    if items is None:  # format get_weigh_ins : par jour
        items = [m for d in raw.get("dailyWeightSummaries") or [] for m in d.get("allWeightMetrics") or []]
    return [x for x in items or [] if isinstance(x, dict)]


def store_weigh_ins(db: Session, user_id: int, raw) -> int:
    """Enregistre les pesées Garmin absentes (repérées par samplePk). Renvoie le nombre de nouvelles."""
    added = 0
    for item in weigh_in_items(raw):
        values = parse_weigh_in(item)
        if not values:
            continue
        pk = str(item.get("samplePk") or f"{values['date']}-{values['poids_kg']}")
        row = db.query(BodyComposition).filter_by(user_id=user_id, garmin_sample_pk=pk).first()
        if not row:
            row = BodyComposition(user_id=user_id, garmin_sample_pk=pk, source="garmin")
            db.add(row)
            added += 1
        for k, v in values.items():
            setattr(row, k, v)
        row.raw_data = json.dumps(item, ensure_ascii=False, default=str)
    db.commit()
    return added


def sync_body(api, db: Session, user: User, today: date, history_days: int | None = None) -> int:
    start = today - timedelta(days=(history_days or BODY_DEFAULT_DAYS) - 1)
    raw = api.get_body_composition(start.isoformat(), today.isoformat())
    added = store_weigh_ins(db, user.id, raw)
    apply_protein_target(db, user)
    return added


def latest_weight(db: Session, user_id: int) -> float | None:
    row = (db.query(BodyComposition).filter_by(user_id=user_id)
           .order_by(BodyComposition.date.desc(), BodyComposition.id.desc()).first())
    return row.poids_kg if row else None


def apply_protein_target(db: Session, user: User):
    """Objectif protéines en g/kg : recalculé avec le dernier poids connu."""
    if not user.proteines_g_kg:
        return
    poids = latest_weight(db, user.id)
    if poids:
        user.proteines_cible = round(user.proteines_g_kg * poids)
        db.commit()


# ── Forme & entraînement (jour même) ──────────────────────────────────────────

FITNESS_ENDPOINTS = [
    ("readiness", lambda api, d: api.get_morning_training_readiness(d)),
    ("training_status", lambda api, d: api.get_training_status(d)),
    ("race_predictions", lambda api, d: api.get_race_predictions()),
    ("endurance", lambda api, d: api.get_endurance_score(d)),
    ("hill", lambda api, d: api.get_hill_score(d)),
    ("fitness_age", lambda api, d: api.get_fitnessage_data(d)),
]


def fetch_fitness(api, day: date) -> dict:
    """Un appel par indicateur ; une montre qui ne gère pas un indicateur renvoie une erreur ou rien."""
    raw: dict = {"date": day.isoformat(), "errors": {}}
    for key, call in FITNESS_ENDPOINTS:
        try:
            raw[key] = call(api, day.isoformat())
        except Exception as e:
            raw["errors"][key] = str(e)[:200]
    return raw


def _readiness(r) -> tuple[int | None, str | None, str | None]:
    if isinstance(r, list):
        r = r[-1] if r else None
    if not isinstance(r, dict):
        return None, None, None
    level = str(r.get("level") or "").upper()
    feedback = r.get("feedbackShort") or r.get("feedbackLong")
    return _int(r.get("score")), READINESS_LABELS.get(level, level.capitalize() or None), feedback


def _training_status(raw) -> dict:
    out: dict = {}
    if not isinstance(raw, dict):
        return out
    latest = (raw.get("mostRecentTrainingStatus") or {}).get("latestTrainingStatusData") or {}
    devices = [v for v in latest.values() if isinstance(v, dict)] if isinstance(latest, dict) else []
    device = next((d for d in devices if d.get("primaryTrainingDevice")), devices[0] if devices else None)
    if device:
        phrase = str(device.get("trainingStatusFeedbackPhrase") or "")
        key = next((k for k in TRAINING_STATUS_LABELS if phrase.startswith(k)), None)
        out["statut_entrainement"] = TRAINING_STATUS_LABELS.get(key) if key else None
        load = device.get("acuteTrainingLoadDTO") or {}
        out["charge_aigue"] = _int(load.get("dailyTrainingLoadAcute"))
        out["charge_chronique"] = _int(load.get("dailyTrainingLoadChronic"))
    vo2 = raw.get("mostRecentVO2Max") or {}
    generic = vo2.get("generic") or {}
    cycling = vo2.get("cycling") or {}
    out["vo2max"] = _num(generic.get("vo2MaxPreciseValue") or generic.get("vo2MaxValue"))
    out["vo2max_velo"] = _num(cycling.get("vo2MaxPreciseValue") or cycling.get("vo2MaxValue"))
    return out


def apply_fitness(row: FitnessMetric, raw: dict):
    score, niveau, conseil = _readiness(raw.get("readiness"))
    row.readiness_score, row.readiness_niveau, row.readiness_conseil = score, niveau, conseil
    status = _training_status(raw.get("training_status"))
    for k in ("statut_entrainement", "charge_aigue", "charge_chronique", "vo2max", "vo2max_velo"):
        setattr(row, k, status.get(k))
    race = raw.get("race_predictions")
    if isinstance(race, list):
        race = race[-1] if race else None
    race = race if isinstance(race, dict) else {}
    row.prediction_5k_s = _int(race.get("time5K"))
    row.prediction_10k_s = _int(race.get("time10K"))
    row.prediction_semi_s = _int(race.get("timeHalfMarathon"))
    row.prediction_marathon_s = _int(race.get("timeMarathon"))
    row.endurance_score = _int(_find(raw.get("endurance"), "overallScore"))
    row.hill_score = _int(_find(raw.get("hill"), "overallScore"))
    row.age_forme = _num(_find(raw.get("fitness_age"), "fitnessAge"))


def sync_fitness(api, db: Session, user: User, today: date, force: bool = False) -> bool:
    """Indicateurs du jour, au plus une fois toutes les 3 h (inutile de rappeler Garmin à chaque synchro)."""
    row = db.query(FitnessMetric).filter_by(user_id=user.id, date=today).first()
    if row and row.synced_at and not force and datetime.utcnow() - row.synced_at < FITNESS_REFRESH:
        return False
    raw = fetch_fitness(api, today)
    if not row:
        row = FitnessMetric(user_id=user.id, date=today)
        db.add(row)
    apply_fitness(row, raw)
    row.raw_data = json.dumps(raw, ensure_ascii=False, default=str)
    row.synced_at = datetime.utcnow()
    db.commit()
    return True


def recompute_body_fitness(db: Session, user_id: int) -> tuple[int, int]:
    """Relit les JSON bruts déjà stockés (pesées, forme), sans appeler Garmin."""
    weigh = fit = 0
    for row in db.query(BodyComposition).filter(BodyComposition.user_id == user_id, BodyComposition.raw_data.isnot(None)):
        try:
            values = parse_weigh_in(json.loads(row.raw_data))
        except ValueError:
            continue
        if values:
            for k, v in values.items():
                setattr(row, k, v)
            weigh += 1
    for row in db.query(FitnessMetric).filter(FitnessMetric.user_id == user_id, FitnessMetric.raw_data.isnot(None)):
        try:
            apply_fitness(row, json.loads(row.raw_data))
            fit += 1
        except ValueError:
            continue
    db.commit()
    return weigh, fit
