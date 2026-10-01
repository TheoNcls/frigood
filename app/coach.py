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
ses pesées, ses tâches passées et à venir, et le contenu de son frigo.

Tu réponds dans le format JSON demandé :
- « remarques » : ce que tu remarques sur les derniers jours (nutrition, sport, régularité), en Markdown (listes à puces).
- « sante_recuperation » : la récupération est-elle bonne, le sommeil est-il bon, comment va la santé globale
  (sommeil, HRV, fréquence cardiaque au repos, stress, body battery, disposition, charge d'entraînement, poids) — en Markdown.
- « ameliorations » : conseils concrets pour t'améliorer, en Markdown.
- « recettes » : 1 ou 2 petites recettes végétariennes simples, adaptées à ses besoins (protéines, micronutriments
  qui manquent) et, si possible, avec ce qu'il y a dans son frigo (en priorité ce qui périme bientôt).
- « activites » : les séances de sport que tu conseilles pour la semaine, uniquement entre les dates indiquées
  (au plus une par jour, jours de repos compris dans ton raisonnement). Choisis le sport parmi la liste fournie.
  Tiens compte de la récupération, des séances déjà prévues dans ses tâches (ne les duplique pas) et de ses objectifs.
  Le titre est court et précis (ex. « Course tempo 20 min », « Vélo endurance 1 h ») ; le détail décrit la séance
  (échauffement, corps de séance, allure ou zone cardiaque, retour au calme).

Règles :
- Appuie chaque remarque sur les données (chiffres, dates, tendances) ; ne devine pas ce qui n'y est pas.
- Si une donnée manque ou semble incomplète (repas non saisis, montre non portée), dis-le simplement sans en tirer de conclusion.
- Tiens compte de ses objectifs et contraintes écrits ; s'ils sont absents, base-toi sur ses objectifs nutritionnels.
- Nutrition végétarienne : surveille protéines, B12, fer, zinc, calcium, iode, oméga-3 ; propose des aliments concrets.
- Sport : relie charge et récupération ; reste prudent sur l'intensité si la récupération est mauvaise.
- Markdown simple : listes à puces courtes, gras pour l'essentiel, pas de titres (les sections sont déjà titrées).
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
        if t.important:
            continue  # les tâches importantes restent privées : jamais envoyées au coach
        for d in occurrences(t, start, end):
            statut = done.get((t.id, d)) or ("fait" if t.activity_type_id and sport.get((t.activity_type_id, d)) else None)
            item = {"date": d.isoformat(), "heure": t.heure, "titre": t.titre, "notes": t.notes,
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

def week_window(today: date) -> tuple[date, date]:
    """Séances proposées d'aujourd'hui jusqu'au dimanche (le dimanche : ce jour-là seulement)."""
    return today, today + timedelta(days=6 - today.weekday())


def response_schema(sports: list[str]) -> dict:
    markdown = {"type": "string", "description": "Markdown simple (listes à puces, gras), sans titre"}
    return {
        "type": "object",
        "properties": {
            "remarques": {**markdown, "description": "Ce que je remarque sur les derniers jours"},
            "sante_recuperation": {**markdown, "description": "Récupération, sommeil et santé globale"},
            "ameliorations": {**markdown, "description": "Conseils pour s'améliorer"},
            "recettes": {
                "type": "array",
                "description": "1 ou 2 petites recettes végétariennes",
                "items": {
                    "type": "object",
                    "properties": {
                        "titre": {"type": "string"},
                        "pourquoi": {"type": "string", "description": "Ce que la recette apporte, en une phrase"},
                        "ingredients": {"type": "array", "items": {"type": "string"}},
                        "etapes": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["titre", "pourquoi", "ingredients", "etapes"],
                    "additionalProperties": False,
                },
            },
            "activites": {
                "type": "array",
                "description": "Séances conseillées pour la semaine, entre les dates indiquées",
                "items": {
                    "type": "object",
                    "properties": {
                        "date": {"type": "string", "format": "date"},
                        "sport": {"type": "string", "enum": sports},
                        "titre": {"type": "string"},
                        "duree_min": {"type": "integer"},
                        "details": {"type": "string"},
                    },
                    "required": ["date", "sport", "titre", "duree_min", "details"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["remarques", "sante_recuperation", "ameliorations", "recettes", "activites"],
        "additionalProperties": False,
    }


def ask_claude(context: dict, sports: list[str], week: tuple[date, date]) -> tuple[dict, dict]:
    """Renvoie (bilan structuré, infos d'usage). Lève CoachError avec un message lisible."""
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise CoachError("ANTHROPIC_API_KEY non configurée sur le serveur")
    import anthropic

    client = anthropic.Anthropic(api_key=api_key)
    sports = sorted(set(sports)) or ["Course à pied"]
    user_message = (
        f"Fais-moi mon bilan. Séances à proposer entre le {week[0].isoformat()} et le {week[1].isoformat()} inclus.\n"
        f"Sports possibles : {', '.join(sports)}.\n\nVoici mes données Frigood (JSON) :\n\n"
        + json.dumps(context, ensure_ascii=False, separators=(",", ":"), default=str)
    )
    try:
        # Streaming : la réponse peut prendre un moment (évite les délais d'attente HTTP)
        with client.beta.messages.stream(
            model=MODEL,
            max_tokens=16000,
            system=SYSTEM_PROMPT,
            thinking={"type": "adaptive"},
            output_config={"effort": "high", "format": {"type": "json_schema", "schema": response_schema(sports)}},
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
    if message.stop_reason == "max_tokens":
        raise CoachError("Le bilan était trop long et a été coupé, réessaie")
    text = next((b.text for b in message.content if b.type == "text"), "")
    try:
        data = json.loads(text)
    except ValueError:
        raise CoachError("Réponse du coach illisible, réessaie")
    usage = {"model": message.model, "input_tokens": message.usage.input_tokens, "output_tokens": message.usage.output_tokens}
    return clean_result(data, set(sports), week), usage


def clean_result(data: dict, sports: set[str], week: tuple[date, date]) -> dict:
    """Garde seulement des séances valides (dans la semaine, sport connu, une par jour)."""
    activites, days = [], set()
    for a in data.get("activites") or []:
        try:
            d = date.fromisoformat(str(a.get("date")))
        except ValueError:
            continue
        if not (week[0] <= d <= week[1]) or a.get("sport") not in sports or d in days or not str(a.get("titre") or "").strip():
            continue
        days.add(d)
        duree = a.get("duree_min")
        activites.append({
            "date": d.isoformat(), "sport": a["sport"], "titre": str(a["titre"]).strip()[:200],
            "duree_min": duree if isinstance(duree, int) and 0 < duree < 600 else None,
            "details": str(a.get("details") or "").strip()[:2000],
        })
    activites.sort(key=lambda a: a["date"])
    return {
        "remarques": str(data.get("remarques") or "").strip(),
        "sante_recuperation": str(data.get("sante_recuperation") or "").strip(),
        "ameliorations": str(data.get("ameliorations") or "").strip(),
        "recettes": [r for r in (data.get("recettes") or [])[:2] if isinstance(r, dict) and r.get("titre")],
        "activites": activites,
    }


def to_markdown(result: dict) -> str:
    """Version texte du bilan (gardée en base, lisible telle quelle)."""
    parts = [
        "## Ce que je remarque sur les derniers jours", result["remarques"],
        "## Santé & récupération", result["sante_recuperation"],
        "## Pour t'améliorer", result["ameliorations"],
    ]
    if result["recettes"]:
        parts.append("## Recettes")
        for r in result["recettes"]:
            parts.append(f"**{r['titre']}** — {r.get('pourquoi', '')}")
            parts.extend(f"- {i}" for i in r.get("ingredients") or [])
            parts.extend(f"{n}. {e}" for n, e in enumerate(r.get("etapes") or [], 1))
    if result["activites"]:
        parts.append("## Activités proposées")
        parts.extend(f"- {a['date']} : **{a['titre']}** ({a['sport']}) — {a['details']}" for a in result["activites"])
    return "\n\n".join(p for p in parts if p)
