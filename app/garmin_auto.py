"""Synchro Garmin automatique du matin, pour les comptes qui l'ont activée.

Garmin (Cloudflare) bloque vite les serveurs qui enchaînent les appels. Précautions :
- jamais de connexion par mot de passe : uniquement la session enregistrée (rafraîchie par OAuth) ;
- un seul compte synchronisé par passage (toutes les 5 min), avec un décalage propre à chaque compte ;
- si la session vient d'être synchronisée à la main, on ne rappelle pas Garmin ;
- après un échec : nouvel essai 1 h puis 3 h plus tard, abandon pour la journée au 3e ;
- si Garmin bloque (429 / 403 / Cloudflare), plus aucun appel automatique pendant 1 h, pour personne.
"""
import logging
import os
import threading
import time
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.garmin_service import GarminSessionExpired, login_with_tokens, run_sync
from app.models import DailyStat, User
from app.push_service import TZ, now_local

log = logging.getLogger("frigood.garmin_auto")

INTERVAL_S = int(os.getenv("GARMIN_AUTO_INTERVAL", "300"))
JITTER_MIN = 15                  # décalage 0-14 min selon le compte : pas tout le monde à 7:00 pile
RETRY_DELAYS_MIN = [60, 180]     # après le 1er puis le 2e échec
MAX_TRIES = 3
BLOCK_COOLDOWN = timedelta(hours=1)

_cooldown_until: datetime | None = None   # heure locale jusqu'à laquelle on n'appelle plus Garmin


def is_blocked_error(message: str) -> bool:
    return any(k in message for k in ("429", "403", "Cloudflare", "TooManyRequests", "Too Many Requests"))


def start_time(user: User, day: date) -> datetime:
    hh, mm = (int(x) for x in (user.garmin_auto_heure or "07:00").split(":"))
    return datetime.combine(day, datetime.min.time()).replace(hour=hh, minute=mm) + timedelta(minutes=(user.id * 7) % JITTER_MIN)


def due_users(db: Session, now: datetime) -> list[User]:
    today = now.date()
    users = db.query(User).filter(User.garmin_auto_sync.is_(True), User.garmin_tokens.isnot(None)).all()
    due = [
        u for u in users
        if u.garmin_auto_date != today
        and (u.garmin_auto_next_at is None or now >= u.garmin_auto_next_at)
        and now >= start_time(u, today)
    ]
    return sorted(due, key=lambda u: start_time(u, today))


def _local(dt_utc: datetime) -> datetime:
    return dt_utc.replace(tzinfo=timezone.utc).astimezone(TZ).replace(tzinfo=None)


def run_once(db: Session, now: datetime | None = None) -> int | None:
    """Synchronise au plus un compte ; renvoie son id (ou None si rien à faire)."""
    global _cooldown_until
    now = now or now_local()
    if _cooldown_until and now < _cooldown_until:
        return None
    users = due_users(db, now)
    if not users:
        return None
    user = users[0]
    today = now.date()
    if user.garmin_auto_next_at and user.garmin_auto_next_at.date() < today:
        # Relance prévue hier soir : nouvelle journée, nouveaux essais
        user.garmin_auto_tries = 0
        user.garmin_auto_next_at = None

    # Déjà synchronisé à la main depuis l'heure prévue : inutile de rappeler Garmin
    last = db.query(func.max(DailyStat.synced_at)).filter(DailyStat.user_id == user.id).scalar()
    if last and _local(last) >= start_time(user, today):
        _done(db, user, today, f"Déjà à jour (synchro manuelle à {_local(last):%H:%M})")
        return user.id

    try:
        api = login_with_tokens(user, db)
        res = run_sync(api, db, user, today, auto=True)
    except GarminSessionExpired:
        _done(db, user, today, "Session Garmin expirée : reconnecte-toi depuis la page Sport")
        return user.id
    except Exception as e:
        message = str(e)[:200]
        blocked = is_blocked_error(message)
        if blocked:
            _cooldown_until = now + BLOCK_COOLDOWN
        user.garmin_auto_tries = (user.garmin_auto_tries or 0) + 1
        label = "Garmin bloque les appels du serveur" if blocked else f"Erreur Garmin : {message}"
        if user.garmin_auto_tries >= MAX_TRIES:
            _done(db, user, today, f"{label} — nouvel essai demain")
        else:
            user.garmin_auto_next_at = now + timedelta(minutes=RETRY_DELAYS_MIN[user.garmin_auto_tries - 1])
            user.garmin_auto_status = f"{label} — nouvel essai à {user.garmin_auto_next_at:%H:%M}"
            db.commit()
        log.warning("Synchro auto Garmin échouée (compte %s, essai %s) : %s", user.id, user.garmin_auto_tries, message)
        return user.id

    parts = [f"{res['stats_days']} jour(s)"]
    if res["imported"]:
        parts.append(f"{res['imported']} activité(s)")
    _done(db, user, today, f"Synchro de {now:%H:%M} : " + ", ".join(parts))
    user.garmin_auto_last_at = datetime.utcnow()
    db.commit()
    log.info("Synchro auto Garmin OK (compte %s) : %s", user.id, res)
    return user.id


def _done(db: Session, user: User, today: date, status: str):
    """Journée close (réussie ou abandonnée) : les essais repartent de zéro le lendemain."""
    user.garmin_auto_date = today
    user.garmin_auto_tries = 0
    user.garmin_auto_next_at = None
    user.garmin_auto_status = status
    db.commit()


def start_scheduler():
    if os.getenv("GARMIN_AUTO", "on") == "off":
        log.info("Synchro Garmin automatique désactivée (GARMIN_AUTO=off)")
        return
    from app.database import SessionLocal

    def loop():
        while True:
            try:
                with SessionLocal() as db:
                    run_once(db)
            except Exception:
                log.exception("Erreur pendant la synchro Garmin automatique")
            time.sleep(INTERVAL_S)

    threading.Thread(target=loop, name="frigood-garmin-auto", daemon=True).start()
    log.info("Synchro Garmin automatique active (vérification toutes les %d s)", INTERVAL_S)
