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


# ── Renforcement musculaire ───────────────────────────────────────────────────

# Matériel (clé -> libellé) : le coach ne reçoit que les exercices faisables avec le matériel coché
EQUIPMENT = {
    "halteres": "Haltères",
    "kettlebell": "Kettlebell",
    "elastiques": "Élastiques",
    "barre": "Barre et disques",
    "banc": "Banc de musculation",
    "barre_traction": "Barre de traction",
    "machines": "Machines et poulies (salle)",
    "trx": "TRX / sangles de suspension",
    "swiss_ball": "Swiss ball",
    "medecine_ball": "Médecine-ball",
}

# Exercices proposés au coach : nom français -> (nom exact du catalogue Garmin, matériel nécessaire).
# Une liste fermée, pour qu'il n'invente pas un exercice que la montre ne connaît pas
STRENGTH_EXERCISES = {
    # ── Poids du corps : haut du corps
    "Pompes": ("Push-up", ()),
    "Pompes sur les genoux": ("Kneeling Push-up", ()),
    "Pompes inclinées": ("Incline Push-up", ()),
    "Pompes déclinées": ("Decline Push-up", ()),
    "Pompes diamant": ("Diamond Push-up", ()),
    "Pompes piquées": ("Pike Push-up", ()),
    "Dips sur banc": ("Bench Dip", ()),          # une chaise suffit
    "Dips": ("Body-weight Dip", ()),
    "Superman": ("Superman from Floor", ()),
    "Extension du dos": ("Static Back Extension", ()),
    # ── Poids du corps : jambes et fessiers
    "Squat": ("Air Squat", ()),
    "Squat sumo": ("Sumo Squat", ()),
    "Chaise (squat contre le mur)": ("Body-weight Wall Squat", ()),
    "Squat sauté": ("Jump Squat", ()),
    "Pistol squat": ("Pistol Squat", ()),
    "Squat bulgare": ("Overhead Bulgarian Split Squat", ()),
    "Fentes": ("Lunge", ()),
    "Fentes marchées": ("Walking Lunge", ()),
    "Fentes arrière": ("Reverse Lunge with Reach Back", ()),
    "Fentes latérales": ("Side Lunge", ()),
    "Fentes sautées": ("Alternating Jump Lunge", ()),
    "Step-up": ("Step-up", ()),
    "Pont fessier": ("Hip Raise", ()),
    "Pont fessier une jambe": ("Single-leg Hip Raise", ()),
    "Pont fessier en marche": ("Marching Hip Raise", ()),
    "Mollets": ("Calf Raise", ()),
    "Mollets une jambe": ("Single-leg Standing Calf Raise", ()),
    "Abduction de hanche couché": ("Side-lying Leg Raise", ()),
    "Fire hydrant": ("Fire Hydrant Kicks", ()),
    "Extension de hanche à quatre pattes": ("Quadruped Hip Extension", ()),
    "Bird dog": ("Opposite Arm and Leg Balance", ()),
    # ── Poids du corps : gainage et abdos
    "Gainage": ("Plank", ()),
    "Gainage latéral": ("Side Plank", ()),
    "Gainage sur les genoux": ("Kneeling Plank", ()),
    "Gainage avec levée de jambe": ("Plank with Leg Lift", ()),
    "Gainage genou-coude": ("Plank with Knee-to-Elbow", ()),
    "Gainage dorsal": ("Lying Reverse Plank", ()),
    "Planche jacks": ("Elbow Plank Pike Jacks", ()),
    "Crunch": ("Crunch", ()),
    "Crunch vélo": ("Bicycle Crunch", ()),
    "Crunch inversé": ("Reverse Crunch", ()),
    "Sit-up": ("Sit-up", ()),
    "V-up": ("V-up", ()),
    "Russian twist": ("Russian Twist", ()),
    "Relevés de jambes": ("Leg Raise", ()),
    "Dead bug": ("Dead Bug", ()),
    "Hollow rock": ("Hollow Rock", ()),
    "Mountain climber": ("Mountain Climber", ()),
    "Bear crawl": ("Bear Crawl", ()),
    # ── Poids du corps : cardio, pliométrie et course
    "Burpees": ("Burpee", ()),
    "Jumping jacks": ("Jumping Jacks", ()),
    "Squat jacks": ("Squat Jacks", ()),
    "Corde à sauter": ("Jump Rope", ()),
    "Montées de genoux": ("Walking High Knees", ()),
    "Sauts latéraux": ("Side-to-Side Shuffle Jump", ()),
    "Bonds latéraux (patineur)": ("Lateral Leap and Hop", ()),
    "Inchworm": ("Walkout", ()),
    # ── Échauffement et mobilité
    "Cercles de bras": ("Arm Circles", ()),
    "Cercles de hanches": ("Hip Circles", ()),
    "Balancés de jambes avant-arrière": ("Forward and Backward Leg Swings", ()),
    "Balancés de jambes latéraux": ("Side-to-Side Leg Swings", ()),
    "Rotation thoracique": ("Thoracic Rotation", ()),
    "Chat-vache": ("Cat Cow Stretch", ()),
    "Étirement 90/90": ("90/90 Stretch", ()),
    "Étirement des fléchisseurs de hanche": ("Lunging Hip Flexor Stretch", ()),
    "Étirement des ischios": ("Hamstring Stretch", ()),
    "Étirement des quadriceps": ("Quad Stretch", ()),
    "Étirement des mollets": ("Calf Stretch", ()),
    "Étirement du pigeon": ("Pigeon Pose Stretch", ()),
    "Étirement des fessiers": ("Glutes Stretch", ()),
    "Posture de l'enfant": ("Child's Pose Stretch", ()),
    "Cobra": ("Cobra Stretch", ()),
    # ── Barre de traction
    "Tractions": ("Pull-up", ("barre_traction",)),
    "Tractions supination": ("Chin-up", ("barre_traction",)),
    "Relevés de genoux suspendu": ("Hanging Knee Raise", ("barre_traction",)),
    "Relevés de jambes suspendu": ("Hanging Leg Raise", ("barre_traction",)),
    "Rowing inversé": ("Inverted Row", ("barre_traction",)),
    # ── Haltères
    "Squat goblet": ("Goblet Squat", ("halteres",)),
    "Squat avant haltères": ("Dumbbell Front Squat", ("halteres",)),
    "Fentes haltères": ("Dumbbell Lunge", ("halteres",)),
    "Fentes arrière haltères": ("Dumbbell Reverse Lunge", ("halteres",)),
    "Fentes latérales haltères": ("Dumbbell Side Lunge", ("halteres",)),
    "Squat bulgare haltères": ("Dumbbell Bulgarian Split Squat", ("halteres",)),
    "Step-up haltères": ("Dumbbell Step-up", ("halteres",)),
    "Soulevé de terre haltères": ("Dumbbell Deadlift", ("halteres",)),
    "Soulevé de terre jambes tendues haltères": ("Dumbbell Straight-leg Deadlift", ("halteres",)),
    "Soulevé de terre une jambe haltère": ("Single-leg Romanian Deadlift with Dumbbell", ("halteres",)),
    "Mollets haltères": ("Standing Dumbbell Calf Raise", ("halteres",)),
    "Développé au sol haltères": ("Dumbbell Floor Press", ("halteres",)),
    "Développé épaules haltères": ("Dumbbell Shoulder Press", ("halteres",)),
    "Développé Arnold": ("Arnold Press", ("halteres",)),
    "Rowing haltère": ("Dumbbell Row", ("halteres",)),
    "Élévations latérales": ("Dumbbell Lateral Raise", ("halteres",)),
    "Élévations frontales": ("Front Raise", ("halteres",)),
    "Oiseau haltères": ("Bent-over Lateral Raise", ("halteres",)),
    "Rowing menton haltères": ("Dumbbell Upright Row", ("halteres",)),
    "Haussements d'épaules haltères": ("Dumbbell Shrug", ("halteres",)),
    "Curl haltères": ("Dumbbell Biceps Curl", ("halteres",)),
    "Curl marteau": ("Dumbbell Hammer Curl", ("halteres",)),
    "Kickback triceps": ("Dumbbell Kick-back", ("halteres",)),
    "Thruster haltères": ("Dumbbell Thrusters", ("halteres",)),
    "Marche du fermier": ("Farmer's Walk", ("halteres",)),
    "Woodchop haltère": ("Dumbbell Chop", ("halteres",)),
    # ── Haltères + banc
    "Développé couché haltères": ("Dumbbell Bench Press", ("halteres", "banc")),
    "Développé incliné haltères": ("Incline Dumbbell Bench Press", ("halteres", "banc")),
    "Écarté haltères": ("Dumbbell Fly", ("halteres", "banc")),
    "Extension triceps haltère": ("Dumbbell Lying Triceps Extension", ("halteres", "banc")),
    # ── Kettlebell
    "Kettlebell swing": ("Kettlebell Swing", ("kettlebell",)),
    "Swing kettlebell un bras": ("Single-arm Kettlebell Swing", ("kettlebell",)),
    "Squat kettlebell": ("Kettlebell Squat", ("kettlebell",)),
    "Soulevé de terre kettlebell": ("Kettlebell Deadlift", ("kettlebell",)),
    "Soulevé de terre sumo kettlebell": ("Kettlebell Sumo Deadlift", ("kettlebell",)),
    "Rowing kettlebell": ("Kettlebell Row", ("kettlebell",)),
    "Développé kettlebell": ("Kettlebell Chest Press", ("kettlebell",)),
    "Moulin kettlebell": ("Kettlebell Windmill", ("kettlebell",)),
    "Arraché kettlebell": ("Single-arm Kettlebell Snatch", ("kettlebell",)),
    "Turkish get-up": ("Sit-up Turkish Get-up", ("kettlebell",)),
    # ── Élastiques
    "Squat élastique": ("Banded Squat", ("elastiques",)),
    "Pont fessier élastique": ("Banded Glute Bridge", ("elastiques",)),
    "Marche latérale élastique": ("Banded Lateral Band Walks", ("elastiques",)),
    "Clamshell élastique": ("Banded Clam Shells", ("elastiques",)),
    "Donkey kick élastique": ("Banded Donkey Kick", ("elastiques",)),
    "Abduction élastique": ("Banded Leg Abduction", ("elastiques",)),
    "Rowing élastique": ("Banded Row", ("elastiques",)),
    "Tirage vertical élastique": ("Banded Latpull", ("elastiques",)),
    "Écartés arrière élastique": ("Banded Pull Apart", ("elastiques",)),
    "Rotation externe épaule élastique": ("Banded External Rotation", ("elastiques",)),
    "Curl élastique": ("Banded Curl", ("elastiques",)),
    "Élévations latérales élastique": ("Banded Lateral Raise", ("elastiques",)),
    "Good morning élastique": ("Band Good Morning", ("elastiques",)),
    "Pompes élastique": ("Banded Push-ups", ("elastiques",)),
    # ── Barre et disques
    "Squat barre": ("Barbell Back Squat", ("barre",)),
    "Squat avant barre": ("Barbell Front Squat", ("barre",)),
    "Fentes barre": ("Barbell Lunge", ("barre",)),
    "Soulevé de terre": ("Barbell Deadlift", ("barre",)),
    "Soulevé de terre roumain": ("Romanian Deadlift", ("barre",)),
    "Good morning barre": ("Good Morning", ("barre",)),
    "Hip thrust barre": ("Barbell Hip Thrust on Floor", ("barre",)),
    "Développé militaire barre": ("Barbell Shoulder Press", ("barre",)),
    "Rowing barre": ("Barbell Row", ("barre",)),
    "Curl barre": ("Barbell Biceps Curl", ("barre",)),
    "Mollets barre": ("Standing Barbell Calf Raise", ("barre",)),
    "Épaulé (clean)": ("Barbell Power Clean", ("barre",)),
    # ── Barre + banc
    "Développé couché barre": ("Barbell Bench Press", ("barre", "banc")),
    "Développé incliné barre": ("Incline Barbell Bench Press", ("barre", "banc")),
    # ── Machines et poulies
    "Tirage vertical": ("Lat Pull-down", ("machines",)),
    "Tirage horizontal poulie": ("Seated Cable Row", ("machines",)),
    "Presse à cuisses": ("Leg Press", ("machines",)),
    "Leg curl": ("Leg Curl", ("machines",)),
    "Leg extension": ("Leg Extensions", ("machines",)),
    "Face pull": ("Face Pull", ("machines",)),
    "Extension triceps poulie": ("Cable Overhead Triceps Extension", ("machines",)),
    "Curl poulie": ("Cable Biceps Curl", ("machines",)),
    "Écarté poulie (crossover)": ("Cable Crossover", ("machines",)),
    "Woodchop poulie": ("Cable Woodchop", ("machines",)),
    "Crunch poulie": ("Cable Crunch", ("machines",)),
    "Mollets assis": ("Seated Calf Raise", ("machines",)),
    "Rameur": ("Rowing Machine", ("machines",)),
    # ── TRX / suspension
    "Rowing TRX": ("Suspension Row", ("trx",)),
    "Pompes TRX": ("Suspension Push-up", ("trx",)),
    "Squat TRX": ("Suspension Squat", ("trx",)),
    "Fentes TRX": ("Suspension Lunge", ("trx",)),
    "Leg curl TRX": ("Suspension Hamstring Curl", ("trx",)),
    "Gainage TRX": ("Suspension Plank", ("trx",)),
    "Genoux à la poitrine TRX": ("Suspension Knee-to-Chest", ("trx",)),
    "Pike TRX": ("Suspension Pike", ("trx",)),
    "Écarté en Y TRX": ("Suspension Y Fly", ("trx",)),
    "Curl TRX": ("Suspension Curl", ("trx",)),
    # ── Swiss ball
    "Crunch swiss ball": ("Swiss Ball Crunch", ("swiss_ball",)),
    "Roll-out swiss ball": ("Swiss Ball Roll-out", ("swiss_ball",)),
    "Jackknife swiss ball": ("Swiss Ball Jackknife", ("swiss_ball",)),
    "Leg curl swiss ball": ("Swiss Ball Hip Raise and Leg Curl", ("swiss_ball",)),
    "Pont fessier pieds sur swiss ball": ("Hip Raise with Feet on Swiss Ball", ("swiss_ball",)),
    "Extension du dos swiss ball": ("Swiss Ball Back Extension", ("swiss_ball",)),
    "Gainage pieds sur swiss ball": ("Plank with Feet on Swiss Ball", ("swiss_ball",)),
    # ── Médecine-ball
    "Slam médecine-ball": ("Medicine Ball Slam", ("medecine_ball",)),
    "Lancers latéraux médecine-ball": ("Medicine Ball Side Throw", ("medecine_ball",)),
    "Woodchop médecine-ball": ("Medicine Ball Wood Chops", ("medecine_ball",)),
    "Wall ball": ("Wall Ball", ("medecine_ball",)),
    "Squat médecine-ball": ("Medicine Ball Squat", ("medecine_ball",)),
}


def _strength_catalog() -> dict[str, tuple[str, str]]:
    """Nom français -> (catégorie, exercice) Garmin ; seuls les noms trouvés dans le catalogue sont gardés."""
    try:
        from garminconnect.exercises import resolve
    except ImportError:
        return {}
    out = {}
    for fr, (en, _) in STRENGTH_EXERCISES.items():
        e = resolve(en)
        if e:
            out[fr] = (e["category"], e["exercise"])
    return out


STRENGTH_CATALOG = _strength_catalog()


def exercises_for(materiel: list[str] | None) -> list[str]:
    """Exercices faisables avec le matériel coché (tous si la personne n'a rien renseigné)."""
    if materiel is None:
        return sorted(STRENGTH_CATALOG)
    have = set(materiel)
    return sorted(fr for fr in STRENGTH_CATALOG if set(STRENGTH_EXERCISES[fr][1]) <= have)


STRENGTH_KEYS = {"strength_training", "indoor_strength", "hiit"}
STRENGTH_WORDS = ("renfo", "muscu", "force", "strength", "gainage", "crossfit")


def clean_exercises(raw) -> list[dict]:
    out = []
    for e in raw or []:
        if not isinstance(e, dict) or e.get("exercice") not in STRENGTH_CATALOG:
            continue
        reps, duree = _int(e.get("repetitions"), 1, 200), _int(e.get("duree_s"), 5, 600)
        if not reps and not duree:
            continue
        charge = e.get("charge_kg")
        out.append({
            "exercice": e["exercice"],
            "series": _int(e.get("series"), 1, 10) or 3,
            "repetitions": reps if not duree else None,   # répétitions OU durée (gainage…)
            "duree_s": duree,
            "charge_kg": round(float(charge), 1) if isinstance(charge, (int, float)) and not isinstance(charge, bool) and 0 < charge <= 300 else None,
            "repos_s": _int(e.get("repos_s"), 0, 600) if e.get("repos_s") is not None else 60,
        })
        if len(out) >= 15:
            break
    return out


def build_strength_workout(titre: str, exercises: list[dict], notes: str | None = None) -> dict:
    """Un bloc « N séries » par exercice : l'exercice (répétitions ou durée) puis le repos."""
    steps, order, child, total = [], 1, 0, 0
    for e in exercises:
        category, exercise = STRENGTH_CATALOG[e["exercice"]]
        child += 1
        if e.get("duree_s"):
            end, value = {"conditionTypeId": 2, "conditionTypeKey": "time", "displayOrder": 2, "displayable": True}, float(e["duree_s"])
        else:
            end, value = {"conditionTypeId": 10, "conditionTypeKey": "reps", "displayOrder": 10, "displayable": True}, float(e["repetitions"])
        work = {
            "type": "ExecutableStepDTO", "stepOrder": order + 1, "childStepId": child,
            "stepType": {"stepTypeId": 3, "stepTypeKey": "interval", "displayOrder": 3},
            "endCondition": end, "endConditionValue": value, "targetType": NO_TARGET,
            "category": category, "exerciseName": exercise,
        }
        if e.get("charge_kg"):
            work["weightValue"] = e["charge_kg"] * 1000.0   # Garmin : grammes, unité kilogramme
            work["weightUnit"] = {"unitId": 8, "unitKey": "kilogram", "factor": 1000.0}
        inner = [work]
        if e.get("repos_s"):
            inner.append({
                "type": "ExecutableStepDTO", "stepOrder": order + 2, "childStepId": child,
                "stepType": {"stepTypeId": 5, "stepTypeKey": "rest", "displayOrder": 5},
                "endCondition": {"conditionTypeId": 2, "conditionTypeKey": "time", "displayOrder": 2, "displayable": True},
                "endConditionValue": float(e["repos_s"]), "targetType": NO_TARGET,
            })
        steps.append({
            "type": "RepeatGroupDTO", "stepOrder": order, "childStepId": child,
            "stepType": {"stepTypeId": 6, "stepTypeKey": "repeat", "displayOrder": 6},
            "numberOfIterations": e["series"], "smartRepeat": False,
            "endCondition": {"conditionTypeId": 7, "conditionTypeKey": "iterations", "displayOrder": 7, "displayable": False},
            "endConditionValue": float(e["series"]),
            "workoutSteps": inner,
        })
        order += 1 + len(inner)
        total += e["series"] * ((e.get("duree_s") or (e.get("repetitions") or 10) * 3) + (e.get("repos_s") or 0))
    sport = {"sportTypeId": 5, "sportTypeKey": "strength_training", "displayOrder": 5}
    workout = {
        "workoutName": titre[:80], "sportType": sport, "estimatedDurationInSecs": int(total),
        "workoutSegments": [{"segmentOrder": 1, "sportType": sport, "workoutSteps": steps}],
    }
    if notes:
        workout["description"] = notes[:500]
    return workout


def is_strength_task(task: Task) -> bool:
    t = task.activity_type
    if not t:
        return False
    nom = (t.nom or "").lower()
    return (t.garmin_type_key or "") in STRENGTH_KEYS or any(w in nom for w in STRENGTH_WORDS)


def can_send(task: Task) -> bool:
    """Séance détaillée d'un sport que la montre sait guider : course (étapes) ou renforcement (exercices)."""
    if not task.seance:
        return False
    try:
        seance = json.loads(task.seance)
    except ValueError:
        return False
    if isinstance(seance, dict):
        return bool(seance.get("exercices")) and is_strength_task(task)
    return bool(seance) and is_running_task(task)


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
    """Crée la séance (course ou renforcement) dans Garmin Connect et la programme au jour de la tâche."""
    seance = json.loads(task.seance) if task.seance else []
    name = f"{task.titre} · {task.date:%d/%m}"   # la date aide à s'y retrouver sur la montre
    if isinstance(seance, dict):  # renforcement : {"exercices": [...]}
        workout = build_strength_workout(name, seance.get("exercices") or [], task.notes)
    else:
        workout = build_running_workout(name, seance, task.notes)
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
