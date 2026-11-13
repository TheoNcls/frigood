"""Créateur de séances : la personne décrit la séance voulue (sport, ce qu'elle veut, exercices imposés ou non),
Claude ou une autre IA (copier-coller) la construit au format des séances Frigood (étapes ou exercices),
prête à être envoyée sur la montre."""
import json
from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.coach import (
    REPEAT_SCHEMA, STEP_SCHEMA, CoachError, _clean, _milestone, _realise, claude_json, exercise_schema, extract_json,
)
from app.garmin_workouts import (
    EQUIPMENT, RUNNING_KEYS, STRENGTH_CATALOG, STRENGTH_KEYS, STRENGTH_WORDS, _estimate_s, clean_exercises, clean_seance,
    exercises_for,
)
from app.models import Activity, ActivityType, FitnessMetric, Task, User

RECENT_DAYS = 28        # dernières séances du même sport
MAX_RECENT = 12
AROUND_DAYS = 3         # autres séances prévues de J-3 à J+3

SYSTEM_PROMPT = """Tu es le coach sportif de Frigood. Tu écris en français.
On te donne en JSON la demande de séance écrite par la personne (sport, date, ce qu'elle veut), son profil
(âge, objectifs et contexte, zones cardiaques Garmin, matériel), sa forme, ses dernières séances du même sport
et les autres séances prévues autour de cette date.

Construis UNE séance prête à suivre, au plus près de sa demande :
- Sa demande passe avant tout : garde les exercices, durées, distances, allures, séries, répétitions et charges
  qu'elle a fixés. Si elle dit ne vouloir que ce qu'elle a cité, n'ajoute rien. Si elle demande d'en ajouter,
  ou si la séance est manifestement incomplète, ajoute ce qui l'équilibre.
- « seance_actuelle » (si présente) est la séance déjà prévue : la demande dit ce qu'il faut y changer ;
  le reste ne bouge pas.
- Adapte l'intensité à son niveau réel (dernières séances, zones, forme) et à ce qu'elle a écrit de sa santé
  (douleur, blessure : allège et dis-le dans « remarques »). Tiens compte des séances prévues la veille et le lendemain.
- Course à pied (et autres sports d'endurance : vélo, natation, rameur…) : « etapes » détaille la séance
  (échauffement, effort, récupération, retour au calme, blocs répétés), chaque étape en durée OU en distance,
  avec une cible en zone cardiaque (1 à 5, d'après ses zones Garmin) ou en allure (secondes par km, course seulement).
  « exercices » reste vide.
- Renforcement / musculation : « exercices » liste les exercices dans l'ordre, avec séries, répétitions (ou durée
  pour le gainage), charge en kg si utile (sinon null : poids du corps) et repos après chaque série. Uniquement des
  noms de la liste fermée du schéma : prends le plus proche de ce qu'elle demande et, s'il diffère, dis-le dans
  « remarques ». Privilégie le matériel qu'elle a, mais garde un exercice qu'elle demande explicitement.
  « etapes » reste vide.
- Autres sports (yoga, escalade, sports collectifs…) : « etapes » et « exercices » vides, tout est dans « details ».
- « titre » : court et parlant (ex. « Fractionné 10 × 400 m », « Haut du corps : poussée »).
  « details » : l'objectif et les consignes en 1 à 4 lignes de texte simple, sans répéter les étapes ; reprends les
  informations utiles de « notes_actuelles » (lieu, avec qui…).
  « remarques » : 1 à 3 puces Markdown courtes sur ce que tu as ajouté, adapté ou remplacé ; vide si tu as suivi
  la demande à la lettre.
- Sport : celui choisi (« sport_choisi ») ; s'il est vide, celui de la liste qui correspond le mieux à la demande."""


def kind_of(sport: ActivityType | None) -> str:
    """renforcement, course ou autre : la forme de la séance (exercices, étapes, ou texte seulement)."""
    if not sport:
        return "autre"
    key, nom = sport.garmin_type_key or "", (sport.nom or "").lower()
    if key in STRENGTH_KEYS or any(w in nom for w in STRENGTH_WORDS):
        return "renforcement"
    if key in RUNNING_KEYS or "course" in nom:
        return "course"
    return "autre"


def _forme(db: Session, user: User, today: date) -> dict | None:
    last = (db.query(FitnessMetric).filter(FitnessMetric.user_id == user.id, FitnessMetric.date >= today - timedelta(days=14))
            .order_by(FitnessMetric.date.desc()).first())
    if not last:
        return None
    return {"date": last.date.isoformat(), "disposition": last.readiness_score, "statut_entrainement": last.statut_entrainement,
            "charge_aigue": last.charge_aigue, "charge_chronique": last.charge_chronique, "vo2max": last.vo2max,
            "predictions_s": {"5k": last.prediction_5k_s, "10k": last.prediction_10k_s, "semi": last.prediction_semi_s}}


def build_context(db: Session, user: User, draft: dict, sport: ActivityType | None, today: date) -> dict:
    day = draft.get("date") or today
    age = None
    if user.date_naissance:
        b = user.date_naissance
        age = today.year - b.year - ((today.month, today.day) < (b.month, b.day))

    recent = []
    if sport:
        for a in (db.query(Activity).filter(Activity.user_id == user.id, Activity.activity_type_id == sport.id,
                                            Activity.date >= today - timedelta(days=RECENT_DAYS - 1), Activity.date <= today)
                  .order_by(Activity.date.desc()).limit(MAX_RECENT)):
            recent.append({"date": a.date.isoformat(), **_realise(a), "notes": a.notes})

    # Autres séances prévues autour de cette date (les tâches importantes restent privées : jamais envoyées)
    from app.routers.tasks import occurrences   # le routeur importe ce module : import tardif
    start, end = day - timedelta(days=AROUND_DAYS), day + timedelta(days=AROUND_DAYS)
    autour = []
    for t in db.query(Task).filter(Task.user_id == user.id, Task.activity_type_id.isnot(None), Task.important.is_(False),
                                   Task.date <= end):
        if draft.get("task_id") and t.id == draft["task_id"]:
            continue   # la séance qu'on modifie
        for d in occurrences(t, start, end):
            autour.append({"date": d.isoformat(), "sport": t.activity_type.nom if t.activity_type else None,
                           "titre": t.titre, "notes": (t.notes or "")[:200] or None})
    autour.sort(key=lambda x: x["date"])

    seance = None
    if draft.get("etapes") or draft.get("exercices"):
        seance = {"etapes": clean_seance(draft.get("etapes")), "exercices": clean_exercises(draft.get("exercices"))}

    return _clean({
        "aujourd_hui": today.isoformat(),
        "date_seance": day.isoformat(),
        "heure": draft.get("heure"),
        "sport_choisi": sport.nom if sport else None,
        "demande": draft.get("demande"),
        "titre_actuel": draft.get("titre"),
        "notes_actuelles": draft.get("notes"),
        "seance_actuelle": seance,
        "profil": {
            "age": age,
            "objectifs_et_contexte_ecrits_par_la_personne": user.profil_coaching,
            "zones_fc_course_garmin": (user.zones_fc or {}).get("zones"),
            "fc_max": (user.zones_fc or {}).get("fc_max"),
            "jalon_en_cours": _milestone(db, user, today),
            "materiel_renfo_disponible": (["poids du corps"] + [EQUIPMENT[m] for m in user.materiel if m in EQUIPMENT])
                                         if user.materiel is not None else None,
        },
        "forme_garmin": _forme(db, user, today),
        f"dernieres_seances_meme_sport_{RECENT_DAYS}_jours": recent,
        f"autres_seances_prevues_j-{AROUND_DAYS}_a_j+{AROUND_DAYS}": autour,
    })


def user_message(context: dict, sports: list[str], exercises: list[str]) -> str:
    return (f"Crée ma séance. Sports possibles : {', '.join(sports)}.\n"
            f"Exercices faisables avec mon matériel : {', '.join(exercises)}.\n\n"
            "Voici ma demande et mes données Frigood (JSON) :\n\n"
            + json.dumps(context, ensure_ascii=False, separators=(",", ":"), default=str))


def response_schema(sports: list[str]) -> dict:
    return {
        "type": "object",
        "properties": {
            "titre": {"type": "string", "description": "Titre court de la séance"},
            "sport": {"type": "string", "enum": sports},
            "duree_min": {"type": "integer", "description": "Durée totale estimée, en minutes"},
            "details": {"type": "string", "description": "Objectif et consignes en 1 à 4 lignes, sans répéter les étapes"},
            "etapes": {"type": "array", "items": {"anyOf": [STEP_SCHEMA, REPEAT_SCHEMA]},
                       "description": "Course et sports d'endurance : la séance étape par étape (liste vide sinon)"},
            # Tout le catalogue : un exercice demandé explicitement est gardé, même avec un autre matériel
            "exercices": {"type": "array", "items": exercise_schema(sorted(STRENGTH_CATALOG)),
                          "description": "Renforcement / musculation : les exercices dans l'ordre (liste vide sinon)"},
            "remarques": {"type": "string", "description": "Puces Markdown : ce qui a été ajouté, adapté ou remplacé (vide sinon)"},
        },
        "required": ["titre", "sport", "duree_min", "details", "etapes", "exercices", "remarques"],
        "additionalProperties": False,
    }


def external_prompt(context: dict, sports: list[str], exercises: list[str]) -> str:
    """Le même texte qu'envoyé à Claude, à coller dans une autre IA, avec le format de réponse attendu."""
    return (SYSTEM_PROMPT + "\n\n---\n\n" + user_message(context, sports, exercises)
            + "\n\n---\n\nRéponds UNIQUEMENT avec un objet JSON, dans un bloc ```json, conforme à ce schéma JSON :\n"
            + json.dumps(response_schema(sports), ensure_ascii=False, separators=(",", ":"))
            + "\n« etapes » et « exercices » sont des listes vides quand ils ne s'appliquent pas.")


def _text(v, max_len: int) -> str:
    return str(v or "").strip()[:max_len]


def clean_proposal(data: dict, types: list[ActivityType], chosen: ActivityType | None) -> dict:
    """La proposition nettoyée, au format des séances Frigood, pour remplir le formulaire de tâche."""
    by_name = {t.nom: t for t in types}
    sport = by_name.get(str(data.get("sport") or "")) or chosen
    kind = kind_of(sport)
    etapes = clean_seance(data.get("etapes"))
    exercices = clean_exercises(data.get("exercices"))
    if kind == "renforcement":
        etapes = []
    elif kind == "course":
        exercices = []
    if exercices:
        etapes = []   # une séance : des étapes OU des exercices
    duree = data.get("duree_min")
    duree = duree if isinstance(duree, int) and not isinstance(duree, bool) and 1 <= duree <= 600 else None
    if not duree and etapes:
        from app.garmin_laps import flatten
        duree = round(sum(_estimate_s(s) for s in flatten(etapes)) / 60) or None
    return {
        "titre": _text(data.get("titre"), 200) or (f"Séance de {sport.nom.lower()}" if sport else "Séance"),
        "activity_type_id": sport.id if sport else None,
        "sport": sport.nom if sport else None,
        "duree_min": duree,
        "details": _text(data.get("details"), 2000),
        "etapes": etapes,
        "exercices": exercices,
        "remarques": _text(data.get("remarques"), 2000),
    }


def ask_claude(context: dict, types: list[ActivityType], chosen: ActivityType | None, materiel: list[str] | None) -> tuple[dict, dict]:
    sports = sorted(t.nom for t in types) or ["Course à pied"]
    data, usage = claude_json(SYSTEM_PROMPT, user_message(context, sports, exercises_for(materiel)), response_schema(sports),
                              effort="medium", who="Le coach")
    return clean_proposal(data, types, chosen), usage


def parse_external(text: str, types: list[ActivityType], chosen: ActivityType | None) -> dict:
    proposal = clean_proposal(extract_json(text, "la séance"), types, chosen)
    if not (proposal["etapes"] or proposal["exercices"] or proposal["details"]):
        raise CoachError("Aucune séance trouvée dans la réponse (étapes, exercices ou consignes)")
    return proposal
