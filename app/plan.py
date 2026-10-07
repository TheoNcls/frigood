"""Plan à long terme vers les objectifs : jalons mois par mois (km, D+, sortie longue, repères), écrit par Claude.

Généré une seule fois à partir des objectifs écrits dans le profil et de l'historique d'entraînement ;
la personne le modifie ensuite à la main, et le coach de la semaine s'en sert pour ses séances.
"""
import json
import logging
import os
from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.coach import MODEL, CoachError, REGIME_LABELS, context_today
from app.garmin_service import activity_details
from app.models import Activity, BodyComposition, FitnessMetric, User

log = logging.getLogger("frigood.plan")

HISTORY_WEEKS = 16
PLAN_MAX_CHARS = 20000

SYSTEM_PROMPT = """Tu es le coach de Frigood, une application de nutrition, de frigo et de sport.
Tu écris en français, tu tutoies la personne, sur un ton bienveillant, direct et concret.

On te donne en JSON ses objectifs (texte libre qu'elle a écrit), son profil, ses 16 dernières semaines
d'entraînement (par semaine et par sport : séances, km, dénivelé positif, minutes), ses plus longues sorties,
sa forme Garmin (VO2max, prédictions, statut) et ses pesées.

Écris son plan à long terme : les jalons, mois par mois, jusqu'à l'échéance de son objectif principal.
Ce texte est enregistré dans son profil : elle pourra le modifier, et le coach de chaque semaine s'en servira
pour lui proposer ses séances.

Format : Markdown simple, sans tableau, avec exactement ces sections :
## Objectif
2 ou 3 lignes : l'objectif principal reformulé (épreuve, distance, dénivelé, date) et les objectifs secondaires.
Si aucune date n'est donnée, choisis un horizon raisonnable et dis-le.
## Point de départ
Son volume actuel (km et D+ par semaine, plus longue sortie), sa régularité, sa forme ; l'écart avec l'objectif.
## Jalons
Un titre ### par mois jusqu'à l'objectif (ex. « ### Mois 1 · 7 oct. → 6 nov. »), puis ces puces :
- **Volume** : km par semaine (fourchette) et D+ par semaine
- **Sortie longue** : distance, D+ et durée visés en fin de mois
- **Séances clés** : 2 ou 3 types de séances (fractionné, côtes, seuil, endurance, renforcement…)
- **Repère** : ce qu'elle doit être capable de faire en fin de mois (un test simple)
Prévois une semaine plus légère toutes les 3 à 4 semaines et un affûtage avant l'objectif.
## Points d'attention
Récupération, prévention des blessures, matériel, nutrition et hydratation à l'effort, signaux d'alerte.

Règles :
- Pars de son volume réel (les données font foi) et progresse prudemment : pas plus d'environ 10 % de volume
  en plus d'une semaine à l'autre.
- Adapte les jalons au sport de l'objectif (course, trail, vélo, natation…) ; pour un objectif non sportif
  (poids, santé, habitudes), donne des jalons adaptés (poids visé par mois, habitudes à installer).
- Si les données d'entraînement sont rares ou absentes, dis-le et pars d'hypothèses prudentes.
- Utilise ses zones cardiaques Garmin quand c'est utile.
- Tu n'es pas médecin : si elle mentionne une blessure ou un problème de santé, conseille de valider le plan
  avec un professionnel de santé."""


def build_plan_context(db: Session, user: User, today: date) -> dict:
    age = None
    if user.date_naissance:
        b = user.date_naissance
        age = today.year - b.year - ((today.month, today.day) < (b.month, b.day))

    monday = today - timedelta(days=today.weekday())
    start = monday - timedelta(weeks=HISTORY_WEEKS - 1)
    weeks: dict = defaultdict(lambda: defaultdict(lambda: {"seances": 0, "km": 0.0, "d_plus_m": 0, "minutes": 0}))
    longest: dict = {}
    for a in (db.query(Activity).filter(Activity.user_id == user.id, Activity.date >= start, Activity.date <= today)
              .order_by(Activity.date, Activity.id)):
        sport = a.activity_type.nom if a.activity_type else "Autre"
        d_plus = 0
        if a.raw_data:
            try:
                d_plus = int(activity_details(json.loads(a.raw_data)).get("denivele_pos_m") or 0)
            except (ValueError, TypeError, KeyError):
                pass
        w = weeks[a.date - timedelta(days=a.date.weekday())][sport]
        w["seances"] += 1
        w["km"] += a.distance_km or 0
        w["d_plus_m"] += d_plus
        w["minutes"] += a.duree_min or 0
        best = longest.get(sport)
        if a.distance_km and (not best or a.distance_km > best["distance_km"]):
            longest[sport] = {"date": a.date.isoformat(), "distance_km": a.distance_km, "d_plus_m": d_plus, "duree_min": a.duree_min}

    volume = []
    for i in range(HISTORY_WEEKS):
        m = start + timedelta(weeks=i)
        volume.append({"semaine_du": m.isoformat(), "par_sport": {
            s: {**v, "km": round(v["km"], 1)} for s, v in weeks.get(m, {}).items()}})

    last_fit = (db.query(FitnessMetric).filter(FitnessMetric.user_id == user.id)
                .order_by(FitnessMetric.date.desc()).first())
    forme = None
    if last_fit:
        forme = {
            "date": last_fit.date.isoformat(), "vo2max": last_fit.vo2max, "vo2max_velo": last_fit.vo2max_velo,
            "statut_entrainement": last_fit.statut_entrainement, "endurance_score": last_fit.endurance_score,
            "predictions_s": {"5k": last_fit.prediction_5k_s, "10k": last_fit.prediction_10k_s,
                              "semi": last_fit.prediction_semi_s, "marathon": last_fit.prediction_marathon_s},
        }
    pesees = [
        {"date": p.date.isoformat(), "poids_kg": p.poids_kg, "masse_grasse_pct": p.masse_grasse_pct}
        for p in db.query(BodyComposition).filter(
            BodyComposition.user_id == user.id, BodyComposition.date >= today - timedelta(days=90))
        .order_by(BodyComposition.date)
    ]
    return {
        "aujourd_hui": today.isoformat(),
        "objectifs_et_contexte_ecrits_par_la_personne": user.profil_coaching,
        "profil": {
            "prenom": user.nom, "age": age,
            "regime": REGIME_LABELS.get(user.regime_alimentaire or "vegetarien", "végétarien"),
            "zones_fc_course_garmin": (user.zones_fc or {}).get("zones"),
            "fc_max": (user.zones_fc or {}).get("fc_max"),
        },
        f"volume_{HISTORY_WEEKS}_semaines": volume,
        "plus_longues_sorties": longest,
        "forme_garmin": forme,
        "pesees_90_jours": pesees,
    }


def ask_plan(context: dict) -> tuple[str, dict]:
    """Renvoie (plan en Markdown, infos d'usage). Lève CoachError avec un message lisible."""
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise CoachError("ANTHROPIC_API_KEY non configurée sur le serveur")
    import anthropic

    client = anthropic.Anthropic(api_key=api_key)
    user_message = (
        f"Prépare mon plan à long terme vers mes objectifs. Nous sommes le {context_today(context).isoformat()}.\n\n"
        "Voici mes données Frigood (JSON) :\n\n"
        + json.dumps(context, ensure_ascii=False, separators=(",", ":"), default=str)
    )
    try:
        with client.beta.messages.stream(
            model=MODEL,
            max_tokens=32000,   # la réflexion compte dans la limite, en plus du plan
            system=SYSTEM_PROMPT,
            thinking={"type": "adaptive"},
            output_config={"effort": "high"},
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
        log.warning("Plan : requête refusée (%s)", e)
        raise CoachError("Le coach n'a pas pu traiter la demande")
    except anthropic.APIStatusError as e:
        log.warning("Plan : erreur API %s (%s)", e.status_code, getattr(e, "request_id", None))
        raise CoachError("Le service Claude est indisponible, réessaie plus tard")
    except anthropic.APIConnectionError:
        raise CoachError("Impossible de joindre le service Claude")

    if message.stop_reason == "refusal":
        raise CoachError("Le coach a décliné cette demande")
    if message.stop_reason == "max_tokens":
        raise CoachError("Le plan était trop long et a été coupé, réessaie")
    text = "\n\n".join(b.text for b in message.content if b.type == "text").strip()
    if not text:
        raise CoachError("Le coach n'a rien renvoyé, réessaie")
    usage = {"model": message.model, "input_tokens": message.usage.input_tokens, "output_tokens": message.usage.output_tokens}
    return text[:PLAN_MAX_CHARS], usage
