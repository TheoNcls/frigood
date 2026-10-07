"""Garde-fou des synchros Garmin automatiques (à l'ouverture de l'appli).

Garmin (Cloudflare) bloque vite les serveurs qui enchaînent les appels : si Garmin vient de bloquer
(429 / 403 / Cloudflare), plus aucun appel automatique pendant 1 h, pour personne.
Le bouton « Synchroniser » n'est pas concerné : c'est la personne qui décide de réessayer.
"""
from datetime import datetime, timedelta

from app.push_service import now_local

BLOCK_COOLDOWN = timedelta(hours=1)

_cooldown_until: datetime | None = None   # heure locale jusqu'à laquelle on n'appelle plus Garmin


def blocked_now(now: datetime | None = None) -> bool:
    """Garmin a bloqué le serveur il y a peu : aucun appel automatique."""
    return bool(_cooldown_until and (now or now_local()) < _cooldown_until)


def block(now: datetime | None = None):
    global _cooldown_until
    _cooldown_until = (now or now_local()) + BLOCK_COOLDOWN


def is_blocked_error(message: str) -> bool:
    return any(k in message for k in ("429", "403", "Cloudflare", "TooManyRequests", "Too Many Requests"))
