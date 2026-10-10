"""Tours (segments) d'une activité Garmin et comparaison avec la séance prévue.

Les tours demandent un appel à Garmin par activité : fait seulement à la première ouverture du détail
(session enregistrée, jamais le mot de passe), puis gardé en base et plus jamais redemandé.
"""
import json
import threading
import time

from sqlalchemy.orm import Session

from app.garmin_service import PACE_SPORTS, _num
from app.garmin_workouts import PACE_MARGIN_S
from app.models import Activity, Task

# Garmin -> Frigood (mêmes noms que les étapes des séances)
INTENSITY = {
    "WARMUP": "echauffement", "COOLDOWN": "retour_au_calme", "REST": "recuperation", "RECOVERY": "recuperation",
    "INTERVAL": "effort", "ACTIVE": "effort",
}
STRUCTURED = {"WARMUP", "COOLDOWN", "REST", "RECOVERY", "INTERVAL"}
MIN_GAP_S = 2.0   # entre deux appels pour une même personne (Garmin / Cloudflare)

_lock = threading.Lock()
_last_call: dict[int, float] = {}


def space_calls(user_id: int):
    """Espace les appels d'une même personne (plusieurs activités ouvertes à la suite)."""
    with _lock:
        wait = _last_call.get(user_id, 0) + MIN_GAP_S - time.monotonic()
        _last_call[user_id] = time.monotonic() + max(wait, 0)
    if wait > 0:
        time.sleep(wait)


def _summary(activity: Activity) -> dict:
    try:
        return json.loads(activity.raw_data) if activity.raw_data else {}
    except ValueError:
        return {}


def type_key(summary: dict) -> str:
    return ((summary.get("activityType") or {}).get("typeKey") or "").lower()


def can_fetch(activity: Activity) -> bool:
    """Activité Garmin à plusieurs tours (la natation, avec ses longueurs, n'est pas gérée)."""
    if activity.source != "garmin" or not activity.garmin_activity_id:
        return False
    summary = _summary(activity)
    laps = summary.get("lapCount")
    return "swim" not in type_key(summary) and (laps is None or (isinstance(laps, (int, float)) and laps >= 2))


def parse_laps(raw, sport: str) -> list[dict]:
    laps = raw.get("lapDTOs") if isinstance(raw, dict) else raw if isinstance(raw, list) else None
    laps = [lap for lap in laps or [] if isinstance(lap, dict)]
    # Tout petit dernier tour (montre arrêtée juste après la fin de la séance) : du bruit
    if len(laps) > 1 and (_num(laps[-1].get("duration"), 1) or 0) < 20 and (_num(laps[-1].get("distance"), 0) or 0) < 50:
        laps = laps[:-1]
    pace = any(s in sport for s in PACE_SPORTS)
    kinds = [str(lap.get("intensityType") or "").upper() for lap in laps]
    # Séance structurée (échauffement, efforts, récup…) ; sinon de simples tours (tour auto au km, bouton Lap)
    structured = any(k in STRUCTURED for k in kinds)
    out = []
    for lap, kind in zip(laps, kinds):
        distance = _num(lap.get("distance"), 0)
        duree = _num(lap.get("duration") or lap.get("elapsedDuration"), 1)
        speed = _num(lap.get("averageSpeed"), 3) or (distance / duree if distance and duree else None)
        gap = _num(lap.get("avgGradeAdjustedSpeed"), 3)
        step = lap.get("wktStepIndex")
        out.append({
            "numero": len(out) + 1,
            "type": INTENSITY.get(kind, "effort") if structured else "tour",
            "etape": step if isinstance(step, int) else None,
            "distance_m": distance,
            "duree_s": duree,
            "allure_s_km": round(1000 / speed) if pace and speed else None,
            "allure_ajustee_s_km": round(1000 / gap) if pace and gap else None,
            "vitesse_kmh": round(speed * 3.6, 1) if speed else None,
            "fc_moy": _num(lap.get("averageHR"), 0),
            "fc_max": _num(lap.get("maxHR"), 0),
            "cadence": _num(lap.get("averageRunCadence") or lap.get("averageBikeCadence"), 0),
            "d_plus": _num(lap.get("elevationGain"), 0),
            "d_moins": _num(lap.get("elevationLoss"), 0),
            "puissance_w": _num(lap.get("averagePower") or lap.get("avgPower"), 0),
        })
    return out


# ── Séance prévue ─────────────────────────────────────────────────────────────

def planned_task(db: Session, activity: Activity) -> Task | None:
    """Séance de course détaillée prévue ce jour-là pour ce sport (envoyée ou non sur la montre)."""
    tasks = (db.query(Task)
             .filter(Task.user_id == activity.user_id, Task.date == activity.date, Task.seance.isnot(None))
             .order_by(Task.id).all())
    for task in tasks:
        if task.activity_type_id and activity.activity_type_id and task.activity_type_id != activity.activity_type_id:
            continue
        try:
            seance = json.loads(task.seance)
        except ValueError:
            continue
        if isinstance(seance, list) and seance:
            return task
    return None


def flatten(seance: list) -> list[dict]:
    """Étapes dans l'ordre où la montre les enchaîne (blocs répétés dépliés)."""
    out = []
    for s in seance:
        if not isinstance(s, dict):
            continue
        if s.get("type") == "repetition":
            reps = s.get("repetitions") or 1
            for r in range(reps):
                for e in s.get("etapes") or []:
                    out.append({**e, "repetition": f"{r + 1}/{reps}"})
        else:
            out.append(dict(s))
    return out


def _verdict(lap: dict, step: dict, zones: list[dict]) -> str | None:
    if step.get("allure_s_km") and lap.get("allure_s_km"):
        target, actual = step["allure_s_km"], lap["allure_s_km"]
        if actual > target + PACE_MARGIN_S:
            return "lent"
        if actual < target - PACE_MARGIN_S:
            return "rapide"
        return "ok"
    if step.get("zone_fc") and lap.get("fc_moy"):
        zone = next((z for z in zones if z.get("zone") == step["zone_fc"]), None)
        if not zone:
            return None
        if zone.get("min") and lap["fc_moy"] < zone["min"]:
            return "bas"
        if zone.get("max") and lap["fc_moy"] > zone["max"]:
            return "haut"
        return "ok"
    return None


def compare(laps: list[dict], seance: list, zones: list[dict]) -> bool:
    """Associe chaque tour à son étape prévue (dans l'ordre) : vrai si les tours correspondent un à un."""
    steps = flatten(seance)
    # De simples tours (tour auto au km) ne suivent pas les étapes, même s'ils sont aussi nombreux
    if not any(lap["type"] != "tour" for lap in laps):
        return False
    if not steps or len(laps) != len(steps):
        return False
    for lap, step in zip(laps, steps):
        lap["prevu"] = {k: step.get(k) for k in ("type", "duree_s", "distance_m", "allure_s_km", "zone_fc", "repetition")}
        lap["verdict"] = _verdict(lap, step, zones)
    return True


def laps_response(db: Session, activity: Activity) -> dict:
    try:
        raw = json.loads(activity.laps_data)
    except (TypeError, ValueError):
        raw = None
    laps = parse_laps(raw, type_key(_summary(activity)))
    seance = None
    task = planned_task(db, activity) if laps else None
    if task:
        zones = (activity.user.zones_fc or {}).get("zones") or []
        seance = {
            "titre": task.titre,
            "etapes": len(flatten(json.loads(task.seance))),
            "correspondance": compare(laps, json.loads(task.seance), zones),
            "marge_allure_s": PACE_MARGIN_S,
        }
    return {"statut": "ok", "tours": laps, "seance": seance}
