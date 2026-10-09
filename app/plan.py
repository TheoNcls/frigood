"""Plan à long terme vers les objectifs : jalons en blocs de durée libre (km, D+, sortie longue, repères), écrit par Claude.

Généré une seule fois à partir des objectifs écrits dans le profil et de l'historique d'entraînement ;
la personne le modifie ensuite à la main, et le coach de la semaine s'en sert pour ses séances.
"""
import json
import logging
import os
import re
import unicodedata
from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.coach import MODEL, CoachError, REGIME_LABELS, context_today
from app.garmin_service import activity_details
from app.models import Activity, ActivityType, BodyComposition, FitnessMetric, User

log = logging.getLogger("frigood.plan")

HISTORY_WEEKS = 16
PLAN_MAX_CHARS = 20000

SYSTEM_PROMPT = """Tu es le coach de Frigood, une application de nutrition, de frigo et de sport.
Tu écris en français, tu tutoies la personne, sur un ton bienveillant, direct et concret.

On te donne en JSON ses objectifs (texte libre qu'elle a écrit), son profil, ses 16 dernières semaines
d'entraînement (par semaine et par sport : séances, km, dénivelé positif, minutes), ses plus longues sorties,
sa forme Garmin (VO2max, prédictions, statut) et ses pesées.

Écris son plan à long terme : les jalons, bloc par bloc, jusqu'à l'échéance de son objectif principal.
Ce texte est enregistré dans son profil : elle pourra le modifier, et le coach de chaque semaine s'en servira
pour lui proposer ses séances.

Format : Markdown simple, sans tableau, avec exactement ces sections :
## Objectif
2 ou 3 lignes : l'objectif principal reformulé (épreuve, distance, dénivelé, date) et les objectifs secondaires.
Si aucune date n'est donnée, choisis un horizon raisonnable et dis-le.
Termine par la ligne « **Sports comptés** : … » : les sports dont les km et le D+ comptent dans les jalons,
choisis parmi « sports_disponibles » et écrits exactement comme dans cette liste, séparés par des virgules
(ex. pour un trail : « **Sports comptés** : Course à pied, Trail »). N'y mets pas les sports d'appoint
(vélo de récupération, natation…) qui ne préparent pas directement l'objectif.
## Point de départ
Son volume actuel (km et D+ par semaine, plus longue sortie), sa régularité, sa forme ; l'écart avec l'objectif.
## Jalons
Découpe la préparation en blocs (les jalons) qui suivent la logique de l'entraînement, pas le calendrier : par exemple
une base de 4 à 6 semaines, un bloc spécifique de 3 semaines, un affûtage de 10 à 15 jours. Un bloc peut être plus
court ou plus long qu'un mois. Les blocs se suivent sans trou ni chevauchement jusqu'à l'objectif.
Un titre ### par bloc, avec son numéro, son nom et ses dates au format jj/mm (l'appli s'en sert pour suivre le bloc
en cours), par exemple « ### Bloc 1 · Base aérobie · 08/10 → 08/11 », puis exactement ces puces :
- **But** : ce que travaille ce bloc, en une phrase
- **Volume** : 25–30 km/semaine · 400 m D+/semaine   (fourchette de km, puis D+ par semaine)
- **Sortie longue** : 15 km · 300 m D+ · 1 h 45   (visée en fin de bloc)
- **Séances clés** : 2 ou 3 types de séances (fractionné, côtes, seuil, endurance, renforcement…)
- **Repère** : ce qu'elle doit être capable de faire en fin de bloc (un test simple)
Prévois une semaine plus légère toutes les 3 à 4 semaines (dans un bloc ou en bloc à part) et un bloc d'affûtage
avant l'objectif.
## Points d'attention
Récupération, prévention des blessures, matériel, nutrition et hydratation à l'effort, signaux d'alerte.

Règles :
- Pars de son volume réel (les données font foi) et progresse prudemment : pas plus d'environ 10 % de volume
  en plus d'une semaine à l'autre.
- Adapte les jalons au sport de l'objectif (course, trail, vélo, natation…) ; pour un objectif non sportif
  (poids, santé, habitudes), donne des jalons adaptés (poids visé en fin de bloc, habitudes à installer).
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
        "sports_disponibles": sorted(n for (n,) in db.query(ActivityType.nom)),
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


# ── Jalon en cours : lu dans le texte du plan (modifiable), comparé aux activités réelles ──────────────

_MONTHS = {"jan": 1, "fév": 2, "fev": 2, "mar": 3, "avr": 4, "mai": 5, "juin": 6, "juil": 7,
           "aoû": 8, "aou": 8, "sep": 9, "oct": 10, "nov": 11, "déc": 12, "dec": 12}
_DATE = r"(\d{1,2})\s*(?:/\s*(\d{1,2})|(?:er)?\s+([a-zéûô]+)\.?)"
_RANGE = re.compile(_DATE + r"\s*(?:→|->|–|—|-|au)\s*" + _DATE, re.I)
_NUM = r"(\d+(?:[.,]\d+)?)"
_KM_RANGE = re.compile(_NUM + r"\s*(?:[–—-]|à)\s*" + _NUM + r"\s*km", re.I)
_KM = re.compile(_NUM + r"\s*km", re.I)
_DPLUS = re.compile(r"(\d[\d\s\u202f\u00a0.]*)\s*m\s*(?:de\s*)?D\+", re.I)

FAMILY_LABELS = {"pied": "course, trail, randonnée, marche", "velo": "vélo", "natation": "natation"}
FAMILIES = {   # sport de l'objectif -> activités qui comptent dans le volume
    "velo": (("cycling", "biking", "gravel", "mtb"), ("vélo", "velo", "vtt", "cyclisme", "gravel")),
    "natation": (("swim",), ("natation", "nage")),
    "pied": (("running", "trail", "hiking", "walking"), ("course", "trail", "rando", "marche", "footing")),
}


def _month(token: str | None, num: str | None) -> int | None:
    if num:
        return int(num)
    t = (token or "").lower()
    return next((m for k, m in _MONTHS.items() if t.startswith(k)), None)


def _float(s: str) -> float:
    return float(s.replace(",", "."))


def _dplus(line: str) -> int | None:
    m = _DPLUS.search(line)
    if not m:
        return None
    digits = re.sub(r"[^\d]", "", m.group(1))
    return int(digits) if digits else None


def parse_jalons(text: str, ref_year: int) -> list[dict]:
    """Les sections « ### … jj/mm → jj/mm » du plan, avec leurs cibles (volume, D+, sortie longue)."""
    jalons, current, year, prev_start = [], None, ref_year, None
    for raw in (text or "").splitlines():
        line = raw.strip()
        if line.startswith("## "):
            current = None   # nouvelle partie (Points d'attention…)
            continue
        if line.startswith("###"):
            current = None
            m = _RANGE.search(line)
            if not m:
                continue
            d1, mo1 = int(m.group(1)), _month(m.group(3), m.group(2))
            d2, mo2 = int(m.group(4)), _month(m.group(6), m.group(5))
            if not (mo1 and mo2):
                continue
            try:
                start = date(year, mo1, d1)
                if prev_start and start < prev_start - timedelta(days=15):
                    year += 1
                    start = date(year, mo1, d1)
                end = date(year, mo2, d2)
                if end < start:
                    end = date(year + 1, mo2, d2)
            except ValueError:
                continue
            prev_start = start
            current = {"titre": line.lstrip("#").strip(), "debut": start, "fin": end, "lignes": [], "cibles": {}}
            jalons.append(current)
            continue
        if current and line:
            item = re.sub(r"^[-*•]\s*", "", line)
            if (found := sports_of(item)):
                current["sports"] = found
                continue
            current["lignes"].append(item)
            low = item.lower()
            c = current["cibles"]
            if "volume" in low:
                r = _KM_RANGE.search(item)
                if r:
                    c["km_semaine_min"], c["km_semaine_max"] = _float(r.group(1)), _float(r.group(2))
                elif (k := _KM.search(item)):
                    c["km_semaine_min"] = c["km_semaine_max"] = _float(k.group(1))
                if (dp := _dplus(item)) is not None:
                    c["d_plus_semaine"] = dp
            elif "sortie longue" in low:
                if (k := _KM.search(item)):
                    c["sortie_longue_km"] = _float(k.group(1))
                if (dp := _dplus(item)) is not None:
                    c["sortie_longue_d_plus"] = dp
    return jalons


_SPORTS_LINE = re.compile(r"sports?\s+compt[ée]s?\s*\**\s*:\s*\**\s*(.+)$", re.I)


def _norm(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", (s or "").lower()) if unicodedata.category(c) != "Mn").strip()


def sports_of(line: str) -> list[str] | None:
    """« **Sports comptés** : Course à pied, Trail » -> ["Course à pied", "Trail"]."""
    m = _SPORTS_LINE.search(re.sub(r"^[-*•]\s*", "", line.strip()))
    if not m:
        return None
    parts = re.split(r"\s*(?:,|;|/|·|\bet\b)\s*", m.group(1).replace("*", ""))
    names = [p.strip(" .") for p in parts if p.strip(" .")]
    return names or None


def plan_sports(text: str) -> list[str] | None:
    """Sports comptés pour tout le plan : la ligne hors des jalons (en général dans « Objectif »)."""
    in_jalon = False
    for raw in (text or "").splitlines():
        line = raw.strip()
        if line.startswith("###"):
            in_jalon = True
        elif line.startswith("## "):
            in_jalon = False
        elif not in_jalon and (found := sports_of(line)):
            return found
    return None


def _family(text: str) -> str:
    """Sans « Sports comptés » : sport deviné dans la seule partie « Objectif » (course / trail par défaut)."""
    obj = ""
    if text:
        m = re.search(r"##\s*Objectif(.*?)(?=\n##\s)", text + "\n## ", re.S | re.I)
        obj = (m.group(1) if m else "").lower()
    for fam in ("velo", "natation"):
        if any(w in obj for w in FAMILIES[fam][1]):
            return fam
    return "pied"


def _counts(activity: Activity, fam: str, sports: list[str] | None = None) -> bool:
    t = activity.activity_type
    if not t:
        return False
    if sports:
        nom = _norm(t.nom)
        return any((tok := _norm(s)) and (tok == nom or tok in nom or nom in tok) for s in sports)
    keys, words = FAMILIES[fam]
    key, nom = (t.garmin_type_key or "").lower(), (t.nom or "").lower()
    return any(k in key for k in keys) or any(w in nom for w in words)


def _d_plus(activity: Activity) -> int:
    if not activity.raw_data:
        return 0
    try:
        return int(activity_details(json.loads(activity.raw_data)).get("denivele_pos_m") or 0)
    except (ValueError, TypeError, KeyError):
        return 0


def current_milestone(db: Session, user: User, today: date) -> dict | None:
    """Jalon (bloc) en cours, ou le prochain, et où on en est : km et D+ de la semaine, plus longue sortie du bloc."""
    if not (user.plan_objectifs or "").strip():
        return None
    ref_year = (user.plan_genere_at.date() if user.plan_genere_at else today).year
    jalons = parse_jalons(user.plan_objectifs, ref_year)
    if not jalons:
        return None
    idx = next((i for i, j in enumerate(jalons) if j["debut"] <= today <= j["fin"]), None)
    if idx is None:
        upcoming = [i for i, j in enumerate(jalons) if j["debut"] > today]
        idx = upcoming[0] if upcoming else len(jalons) - 1
    j = jalons[idx]
    fam = _family(user.plan_objectifs)
    sports = j.get("sports") or plan_sports(user.plan_objectifs)
    monday = today - timedelta(days=today.weekday())
    since = min(monday, j["debut"])
    week = {"km": 0.0, "d_plus_m": 0, "seances": 0}
    longest = {"km": 0.0, "d_plus_m": 0, "date": None}
    for a in (db.query(Activity).filter(Activity.user_id == user.id, Activity.date >= since, Activity.date <= today)
              .order_by(Activity.date)):
        if not _counts(a, fam, sports):
            continue
        dp = _d_plus(a)
        if a.date >= monday:
            week["km"] += a.distance_km or 0
            week["d_plus_m"] += dp
            week["seances"] += 1
        if a.date >= j["debut"] and (a.distance_km or 0) > longest["km"]:
            longest = {"km": a.distance_km or 0, "d_plus_m": dp, "date": a.date.isoformat()}
    total_days = (j["fin"] - j["debut"]).days + 1
    status = "en_cours" if j["debut"] <= today <= j["fin"] else ("a_venir" if j["debut"] > today else "termine")
    return {
        "numero": idx + 1, "nombre": len(jalons), "titre": j["titre"], "statut": status,
        "debut": j["debut"].isoformat(), "fin": j["fin"].isoformat(),
        "jour": max(0, min(total_days, (today - j["debut"]).days + 1)), "jours": total_days,
        "lignes": j["lignes"][:12], "cibles": j["cibles"], "sport": fam,
        # Sports pris en compte : ceux écrits dans le plan, sinon ceux devinés (sports_auto)
        "sports_comptes": sports, "sports_auto": None if sports else FAMILY_LABELS[fam],
        "semaine": {**week, "km": round(week["km"], 1), "depuis": monday.isoformat()},
        "plus_longue_sortie": {**longest, "km": round(longest["km"], 1)},
    }
