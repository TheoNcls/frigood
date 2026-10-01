"""Coach Claude : rassemble les données récentes de l'utilisateur et demande un bilan personnalisé à Claude."""
import json
import logging
import os
from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.fridge_service import to_base_qty
from app.garmin_service import activity_details
from app.models import (
    Activity, BodyComposition, DailyStat, FitnessMetric, FridgeItem, Ingredient, MealLog, Recipe, Task, TaskCompletion, User,
)

log = logging.getLogger("frigood.coach")

MODEL = "claude-opus-5-5"
PAST_DAYS = 14        # repas, activités, santé, tâches passées
NEXT_DAYS = 14        # tâches à venir
WEIGHT_DAYS = 90
# Micronutriments à surveiller en végétarien (noms du catalogue Frigood)
KEY_NUTRIMENTS = ["Vitamine B12", "Fer", "Zinc", "Calcium", "Iode", "Vitamine D", "Oméga-3", "Fibres", "Sel"]

SYSTEM_PROMPT = """Tu es le coach de Frigood, une application de nutrition végétarienne, de frigo et de sport.
Tu écris en français, tu tutoies la personne, sur un ton bienveillant, direct et concret.

On te donne en JSON ses objectifs et contraintes (texte libre qu'elle a écrit), ses objectifs nutritionnels,
ses repas des derniers jours (totaux journaliers et micronutriments clés calculés par l'app), ses activités,
ses données Garmin (sommeil, pas, stress, body battery, HRV, disposition à l'entraînement, VO2max, prédictions),
ses pesées, ses tâches passées (faites ou non) et à venir, et le contenu de son frigo.

Rédige un bilan en Markdown simple, avec exactement ces quatre sections :
## Ce que je remarque sur les derniers jours
## Pour t'améliorer
## Pour la suite
## Mes propositions

- Appuie chaque remarque sur les données (chiffres, dates, tendances) ; ne devine pas ce qui n'y est pas.
- Si une donnée manque ou semble incomplète (repas non saisis, montre non portée), dis-le simplement sans en tirer de conclusion.
- Tiens compte de ses objectifs et contraintes écrits ; s'ils sont absents, base-toi sur ses objectifs nutritionnels.
- Nutrition végétarienne : surveille protéines, B12, fer, zinc, calcium, iode, oméga-3 ; propose des aliments concrets.
- Sport : relie charge, récupération (sommeil, HRV, disposition) et séances prévues ; reste prudent sur l'intensité.
- « Pour la suite » s'appuie sur les tâches et séances prévues ; « Mes propositions » donne 3 à 5 idées précises
  (repas avec ce qu'il y a dans le frigo, séance, habitude), utilisables dans la semaine.
- Listes à puces courtes, gras pour l'essentiel. Environ 400 à 700 mots au total.
- Tu n'es pas médecin : pas de diagnostic ; en cas de signal inquiétant (douleur, perte de poids rapide, fatigue durable),
  conseille d'en parler à un professionnel de santé."""


class CoachError(Exception):
    """Erreur présentable à l'utilisateur."""


def _clean(obj):
    """Retire les valeurs vides pour garder un contexte compact."""
    if isinstance(obj, dict):
        return {k: _clean(v) for k, v in obj.items() if v not in (None, "", [], {})}
    if isinstance(obj, list):
        return [_clean(v) for v in obj]
    if isinstance(obj, float):
        return round(obj, 1)
    return obj


# ── Nutrition (même calcul que l'app : valeurs pour 100 g / 100 ml) ───────────

def _ingredient_totals(ing: Ingredient, qty_base: float, acc: dict):
    f = qty_base / 100
    for key, attr in (("kcal", "calories"), ("proteines_g", "proteines"), ("glucides_g", "glucides"), ("lipides_g", "lipides")):
        acc[key] += (getattr(ing, attr) or 0) * f
    for link in ing.nutriments:
        if link.nutriment and link.nutriment.nom in KEY_NUTRIMENTS:
            acc[f"{link.nutriment.nom} ({link.nutriment.unite})"] += link.valeur * f


def _meal_totals(log_: MealLog, acc: dict):
    if log_.ingredient_id and log_.ingredient:
        _ingredient_totals(log_.ingredient, to_base_qty(log_.ingredient, log_.quantite or 0, log_.type_mesure), acc)
    elif log_.recipe_id and log_.recipe:
        r: Recipe = log_.recipe
        factor = (log_.quantite or 1) / (r.portions or 1)
        for ri in r.ingredients:
            _ingredient_totals(ri.ingredient, to_base_qty(ri.ingredient, ri.quantite, ri.type_mesure) * factor, acc)


def _meal_label(log_: MealLog) -> str:
    if log_.recipe_id and log_.recipe:
        return f"{log_.recipe.nom} × {log_.quantite or 1:g} portion(s)"
    ing = log_.ingredient
    if not ing:
        return "?"
    if log_.type_mesure == "unite":
        return f"{ing.nom} × {log_.quantite or 0:g} unité(s)"
    return f"{ing.nom} {log_.quantite or 0:g} {ing.unite or 'g'}"


# ── Contexte ──────────────────────────────────────────────────────────────────

def build_context(db: Session, user: User, today: date) -> dict:
    start = today - timedelta(days=PAST_DAYS - 1)

    age = None
    if user.date_naissance:
        b = user.date_naissance
        age = today.year - b.year - ((today.month, today.day) < (b.month, b.day))

    # Repas : détail et totaux par jour
    meals = defaultdict(list)
    totals = defaultdict(lambda: defaultdict(float))
    for m in (db.query(MealLog).filter(MealLog.user_id == user.id, MealLog.date >= start, MealLog.date <= today)
              .order_by(MealLog.date, MealLog.id)):
        meals[m.date].append(f"{m.moment} : {_meal_label(m)}")
        _meal_totals(m, totals[m.date])
    repas = [
        {"date": d.isoformat(), "totaux": {k: round(v, 1) for k, v in totals[d].items()}, "repas": meals[d]}
        for d in sorted(meals)
    ]

    activites = []
    for a in (db.query(Activity).filter(Activity.user_id == user.id, Activity.date >= start, Activity.date <= today)
              .order_by(Activity.date, Activity.id)):
        entry = {
            "date": a.date.isoformat(), "type": a.activity_type.nom if a.activity_type else None, "source": a.source,
            "duree_min": a.duree_min, "distance_km": a.distance_km, "calories": a.calories,
            "fc_moy": a.freq_cardiaque_moy, "notes": a.notes,
        }
        if a.raw_data:
            try:
                det = activity_details(json.loads(a.raw_data))
                entry.update({k: det.get(k) for k in (
                    "allure_s_km", "denivele_pos_m", "fc_max", "effet_aerobie", "effet_anaerobie", "effet_libelle", "charge")})
                if det.get("zones_fc"):
                    entry["zones_fc_min"] = {f"Z{z['zone']}": round(z["secondes"] / 60) for z in det["zones_fc"]}
            except (ValueError, TypeError, KeyError):
                pass
        activites.append(entry)

    sante = [
        {"date": s.date.isoformat(), "sommeil_h": s.sommeil_total_h, "sommeil_score": s.sommeil_score,
         "sommeil_profond_h": s.sommeil_profond_h, "pas": s.steps, "objectif_pas": s.steps_goal, "bpm_repos": s.bpm_repos,
         "stress_moy": s.stress_moy, "body_battery_min_max": [s.body_battery_min, s.body_battery_max] if s.body_battery_max else None,
         "hrv_ms": s.hrv_moy}
        for s in db.query(DailyStat).filter(DailyStat.user_id == user.id, DailyStat.date >= start, DailyStat.date <= today)
        .order_by(DailyStat.date)
    ]

    pesees = [
        {"date": p.date.isoformat(), "poids_kg": p.poids_kg, "masse_grasse_pct": p.masse_grasse_pct,
         "masse_musculaire_kg": p.masse_musculaire_kg}
        for p in db.query(BodyComposition).filter(
            BodyComposition.user_id == user.id, BodyComposition.date >= today - timedelta(days=WEIGHT_DAYS - 1))
        .order_by(BodyComposition.date)
    ]

    fitness_rows = (db.query(FitnessMetric).filter(FitnessMetric.user_id == user.id, FitnessMetric.date >= start)
                    .order_by(FitnessMetric.date).all())
    forme = None
    if fitness_rows:
        last = fitness_rows[-1]
        forme = {
            "date": last.date.isoformat(), "disposition": last.readiness_score, "disposition_niveau": last.readiness_niveau,
            "statut_entrainement": last.statut_entrainement, "charge_aigue": last.charge_aigue,
            "charge_chronique": last.charge_chronique, "vo2max": last.vo2max, "vo2max_velo": last.vo2max_velo,
            "predictions_s": {"5k": last.prediction_5k_s, "10k": last.prediction_10k_s,
                              "semi": last.prediction_semi_s, "marathon": last.prediction_marathon_s},
            "endurance_score": last.endurance_score, "age_physique": last.age_forme,
            "disposition_14j": [[r.date.isoformat(), r.readiness_score] for r in fitness_rows if r.readiness_score is not None],
        }

    # Tâches : passées (avec statut) et à venir
    from app.routers.tasks import occurrences, sport_activities
    tasks = db.query(Task).filter(Task.user_id == user.id, Task.date <= today + timedelta(days=NEXT_DAYS)).all()
    end = today + timedelta(days=NEXT_DAYS)
    done = {(c.task_id, c.date): c.statut for c in db.query(TaskCompletion).join(Task).filter(
        Task.user_id == user.id, TaskCompletion.date >= start, TaskCompletion.date <= end)}
    sport = sport_activities(db, user.id, tasks, start, today)
    passees, a_venir = [], []
    for t in tasks:
        for d in occurrences(t, start, end):
            statut = done.get((t.id, d)) or ("fait" if t.activity_type_id and sport.get((t.activity_type_id, d)) else None)
            item = {"date": d.isoformat(), "heure": t.heure, "titre": t.titre, "notes": t.notes, "importante": t.important or None,
                    "sport": t.activity_type.nom if t.activity_type else None}
            if d <= today:
                passees.append({**item, "statut": statut or ("à faire" if d == today else "non cochée")})
            else:
                a_venir.append(item)
    passees.sort(key=lambda x: (x["date"], x.get("heure") or ""))
    a_venir.sort(key=lambda x: (x["date"], x.get("heure") or ""))

    frigo = []
    for f in db.query(FridgeItem).filter(FridgeItem.user_id == user.id).order_by(FridgeItem.date_peremption):
        if f.ingredient_id:
            ing = db.get(Ingredient, f.ingredient_id)
            nom, unite = (ing.nom, ing.unite or "g") if ing else ("?", "")
        else:
            rec = db.get(Recipe, f.recipe_id) if f.recipe_id else None
            nom, unite = (rec.nom if rec else "?"), "portion(s)"
        frigo.append({"aliment": nom, "quantite": f"{f.quantite:g} {unite}",
                      "peremption": f.date_peremption.isoformat() if f.date_peremption else None})

    return _clean({
        "aujourd_hui": today.isoformat(),
        "profil": {
            "prenom": user.nom, "age": age,
            "objectifs_et_contexte_ecrits_par_la_personne": user.profil_coaching,
            "objectifs_nutritionnels_par_jour": {
                "kcal": user.calories_cible, "proteines_g": user.proteines_cible, "proteines_g_par_kg": user.proteines_g_kg,
                "glucides_g": user.glucides_cible, "lipides_g": user.lipides_cible},
            "regime": "végétarien",
        },
        f"repas_{PAST_DAYS}_jours": repas,
        f"activites_{PAST_DAYS}_jours": activites,
        f"sante_garmin_{PAST_DAYS}_jours": sante,
        f"pesees_{WEIGHT_DAYS}_jours": pesees,
        "forme_garmin": forme,
        "taches_passees": passees,
        f"taches_et_seances_a_venir_{NEXT_DAYS}_jours": a_venir,
        "frigo": frigo,
    })


# ── Appel à Claude ────────────────────────────────────────────────────────────

def ask_claude(context: dict) -> tuple[str, dict]:
    """Renvoie (texte Markdown, infos d'usage). Lève CoachError avec un message lisible."""
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise CoachError("ANTHROPIC_API_KEY non configurée sur le serveur")
    import anthropic

    client = anthropic.Anthropic(api_key=api_key)
    user_message = (
        "Voici mes données Frigood (JSON). Fais-moi mon bilan.\n\n"
        + json.dumps(context, ensure_ascii=False, separators=(",", ":"), default=str)
    )
    try:
        # Streaming : la réponse peut prendre un moment (évite les délais d'attente HTTP)
        with client.beta.messages.stream(
            model=MODEL,
            max_tokens=16000,
            system=SYSTEM_PROMPT,
            thinking={"type": "adaptive"},
            output_config={"effort": "high"},
            # Repli automatique sur un autre modèle si celui-ci décline la demande
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            messages=[{"role": "user", "content": user_message}],
        ) as stream:
            message = stream.get_final_message()
    except anthropic.AuthenticationError:
        raise CoachError("Clé API Anthropic refusée")
    except anthropic.RateLimitError:
        raise CoachError("Trop de demandes au coach pour le moment, réessaie dans une minute")
    except anthropic.BadRequestError as e:
        log.warning("Coach : requête refusée (%s)", e)
        raise CoachError("Le coach n'a pas pu traiter la demande")
    except anthropic.APIStatusError as e:
        log.warning("Coach : erreur API %s (%s)", e.status_code, getattr(e, "request_id", None))
        raise CoachError("Le service Claude est indisponible, réessaie plus tard")
    except anthropic.APIConnectionError:
        raise CoachError("Impossible de joindre le service Claude")

    if message.stop_reason == "refusal":
        raise CoachError("Le coach a décliné cette demande")
    text = "\n".join(b.text for b in message.content if b.type == "text").strip()
    if not text:
        raise CoachError("Le coach n'a rien répondu, réessaie")
    usage = {
        "model": message.model,
        "input_tokens": message.usage.input_tokens,
        "output_tokens": message.usage.output_tokens,
        "truncated": message.stop_reason == "max_tokens",
    }
    return text, usage
