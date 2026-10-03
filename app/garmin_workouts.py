"""Séances structurées (course à pied) envoyées sur la montre via Garmin Connect, et zones cardiaques Garmin.

Une séance Frigood est une liste d'étapes (échauffement, effort, récupération, retour au calme)
et de blocs répétés, chacune en durée ou en distance, avec une cible en zone cardiaque (Z1-Z5)
ou en allure. Avec une cible « zone 3 », la montre applique ses propres zones : celles réglées dans Garmin.
"""
import json
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.models import Task, User

ZONES_REFRESH = timedelta(hours=24)
RUNNING_KEYS = {"running", "trail_running", "treadmill_running", "track_running", "street_running", "indoor_running"}
STEP_TYPES = ("echauffement", "effort", "recuperation", "retour_au_calme")
MAX_STEPS = 20

_STEP_TYPE = {  # Frigood -> (stepTypeId, stepTypeKey, displayOrder) Garmin
    "echauffement": (1, "warmup", 1),
    "retour_au_calme": (2, "cooldown", 2),
    "effort": (3, "interval", 3),
    "recuperation": (4, "recovery", 4),
}
NO_TARGET = {"workoutTargetTypeId": 1, "workoutTargetTypeKey": "no.target", "displayOrder": 1}
HR_ZONE_TARGET = {"workoutTargetTypeId": 4, "workoutTargetTypeKey": "heart.rate.zone", "displayOrder": 4}
PACE_TARGET = {"workoutTargetTypeId": 6, "workoutTargetTypeKey": "pace.zone", "displayOrder": 6}
PACE_MARGIN_S = 10   # allure cible ± 10 s/km


# ── Zones cardiaques ──────────────────────────────────────────────────────────

def parse_hr_zones(raw) -> dict | None:
    """Zones du profil course (sinon profil par défaut) : [{zone, min, max}] en bpm."""
    profiles = raw if isinstance(raw, list) else [raw] if isinstance(raw, dict) else []
    profiles = [p for p in profiles if isinstance(p, dict) and p.get("zone1Floor")]
    if not profiles:
        return None
    pick = next((p for p in profiles if str(p.get("sport", "")).upper() == "RUNNING"), None) \
        or next((p for p in profiles if str(p.get("sport", "")).upper() == "DEFAULT"), profiles[0])
    floors = [pick.get(f"zone{i}Floor") for i in range(1, 6)]
    fc_max = pick.get("maxHeartRateUsed")
    if not all(isinstance(f, (int, float)) for f in floors):
        return None
    zones = []
    for i, low in enumerate(floors):
        high = floors[i + 1] - 1 if i < 4 else fc_max
        zones.append({"zone": i + 1, "min": int(low), "max": int(high) if isinstance(high, (int, float)) else None})
    return {
        "profil": str(pick.get("sport") or "DEFAULT").lower(),
        "methode": pick.get("trainingMethod"),
        "fc_max": fc_max,
        "fc_repos": pick.get("restingHeartRateUsed") or pick.get("restingHrUsed"),
        "zones": zones,
    }


def sync_hr_zones(api, db: Session, user: User, force: bool = False) -> bool:
    """Zones cardiaques, au plus une fois par jour (elles changent rarement)."""
    if not force and user.garmin_zones_at and datetime.utcnow() - user.garmin_zones_at < ZONES_REFRESH:
        return False
    parsed = parse_hr_zones(api.get_heart_rate_zones())
    user.garmin_zones_at = datetime.utcnow()
    if parsed:
        user.garmin_zones_fc = json.dumps(parsed, ensure_ascii=False)
    db.commit()
    return bool(parsed)


# ── Séance : nettoyage (réponse du coach) ─────────────────────────────────────

def _int(v, lo, hi):
    return v if isinstance(v, int) and not isinstance(v, bool) and lo <= v <= hi else None


def _clean_step(s) -> dict | None:
    if not isinstance(s, dict) or s.get("type") not in STEP_TYPES:
        return None
    duree, distance = _int(s.get("duree_s"), 10, 4 * 3600), _int(s.get("distance_m"), 50, 50000)
    step = {
        "type": s["type"],
        "duree_s": duree if not distance else None,   # l'un ou l'autre ; rien = jusqu'à l'appui sur « Lap »
        "distance_m": distance,
        "zone_fc": _int(s.get("zone_fc"), 1, 5),
        "allure_s_km": _int(s.get("allure_s_km"), 150, 900),
    }
    if step["zone_fc"]:
        step["allure_s_km"] = None   # une seule cible
    return step


def clean_seance(raw) -> list[dict]:
    steps = []
    for s in raw or []:
        if isinstance(s, dict) and s.get("type") == "repetition":
            reps = _int(s.get("repetitions"), 1, 30)
            inner = [x for x in (_clean_step(i) for i in s.get("etapes") or []) if x]
            if reps and inner:
                steps.append({"type": "repetition", "repetitions": reps, "etapes": inner[:4]})
        elif (step := _clean_step(s)):
            steps.append(step)
        if len(steps) >= MAX_STEPS:
            break
    return steps


# ── Séance : format Garmin ────────────────────────────────────────────────────

def _garmin_step(s: dict, order: int, child: int | None = None) -> dict:
    type_id, type_key, display = _STEP_TYPE[s["type"]]
    if s.get("distance_m"):
        end, value = {"conditionTypeId": 3, "conditionTypeKey": "distance", "displayOrder": 3, "displayable": True}, float(s["distance_m"])
    elif s.get("duree_s"):
        end, value = {"conditionTypeId": 2, "conditionTypeKey": "time", "displayOrder": 2, "displayable": True}, float(s["duree_s"])
    else:
        end, value = {"conditionTypeId": 1, "conditionTypeKey": "lap.button", "displayOrder": 1, "displayable": True}, None
    step = {
        "type": "ExecutableStepDTO", "stepOrder": order,
        "stepType": {"stepTypeId": type_id, "stepTypeKey": type_key, "displayOrder": display},
        "endCondition": end, "endConditionValue": value, "targetType": NO_TARGET,
    }
    if s.get("zone_fc"):
        # La montre applique ses propres zones cardiaques
        step["targetType"] = HR_ZONE_TARGET
        step["zoneNumber"] = s["zone_fc"]
    elif s.get("allure_s_km"):
        slow, fast = s["allure_s_km"] + PACE_MARGIN_S, max(s["allure_s_km"] - PACE_MARGIN_S, 120)
        step["targetType"] = PACE_TARGET
        step["targetValueOne"] = round(1000 / slow, 3)   # m/s, du plus lent…
        step["targetValueTwo"] = round(1000 / fast, 3)   # …au plus rapide
    if child is not None:
        step["childStepId"] = child
    return step


def _estimate_s(s: dict) -> int:
    if s.get("duree_s"):
        return s["duree_s"]
    if s.get("distance_m"):
        return int(s["distance_m"] / 1000 * (s.get("allure_s_km") or 360))
    return 300


def build_running_workout(titre: str, steps: list[dict], notes: str | None = None) -> dict:
    garmin_steps, order, total, child = [], 1, 0, 0
    for s in steps:
        if s["type"] == "repetition":
            child += 1
            group_order = order
            order += 1
            inner = []
            for i in s["etapes"]:
                inner.append(_garmin_step(i, order, child))
                order += 1
                total += _estimate_s(i) * s["repetitions"]
            garmin_steps.append({
                "type": "RepeatGroupDTO", "stepOrder": group_order, "childStepId": child,
                "stepType": {"stepTypeId": 6, "stepTypeKey": "repeat", "displayOrder": 6},
                "numberOfIterations": s["repetitions"], "smartRepeat": False,
                "endCondition": {"conditionTypeId": 7, "conditionTypeKey": "iterations", "displayOrder": 7, "displayable": False},
                "endConditionValue": float(s["repetitions"]),
                "workoutSteps": inner,
            })
        else:
            garmin_steps.append(_garmin_step(s, order))
            order += 1
            total += _estimate_s(s)
    workout = {
        "workoutName": titre[:80],
        "sportType": {"sportTypeId": 1, "sportTypeKey": "running", "displayOrder": 1},
        "estimatedDurationInSecs": int(total),
        "workoutSegments": [{
            "segmentOrder": 1,
            "sportType": {"sportTypeId": 1, "sportTypeKey": "running", "displayOrder": 1},
            "workoutSteps": garmin_steps,
        }],
    }
    if notes:
        workout["description"] = notes[:500]
    return workout


def is_running_task(task: Task) -> bool:
    t = task.activity_type
    if not t:
        return False
    return (t.garmin_type_key or "") in RUNNING_KEYS or "course" in (t.nom or "").lower()


def _find_id(resp, *keys):
    if isinstance(resp, dict):
        for k in keys:
            if resp.get(k):
                return str(resp[k])
    return None


def send_task(api, db: Session, task: Task) -> None:
    """Crée la séance dans Garmin Connect et la programme au jour de la tâche."""
    steps = json.loads(task.seance) if task.seance else []
    workout = build_running_workout(task.titre, steps, task.notes)
    created = api.upload_workout(workout)
    workout_id = _find_id(created, "workoutId", "id")
    if not workout_id:
        raise ValueError(f"Garmin n'a pas renvoyé d'identifiant de séance : {str(created)[:200]}")
    scheduled = api.schedule_workout(workout_id, task.date.isoformat())
    task.garmin_workout_id = workout_id
    task.garmin_schedule_id = _find_id(scheduled, "workoutScheduleId", "scheduledWorkoutId", "id")
    task.garmin_envoye_at = datetime.utcnow()
    db.commit()


def remove_task(api, db: Session, task: Task) -> None:
    """Retire la séance du calendrier Garmin et de la bibliothèque (ce qui existe encore)."""
    if task.garmin_schedule_id:
        try:
            api.unschedule_workout(task.garmin_schedule_id)
        except Exception:
            pass  # déjà retirée côté Garmin
    if task.garmin_workout_id:
        try:
            api.delete_workout(task.garmin_workout_id)
        except Exception:
            pass
    task.garmin_workout_id = task.garmin_schedule_id = task.garmin_envoye_at = None
    db.commit()
