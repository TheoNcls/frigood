"""Notifications push (Web Push / VAPID) et rappels des tâches importantes."""
import json
import logging
import os
import threading
import time
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import Activity, PushSubscription, Task, TaskCompletion, TaskReminder

log = logging.getLogger("frigood.push")

TZ = ZoneInfo(os.getenv("TZ_APP", "Europe/Paris"))
INTERVAL_S = int(os.getenv("REMINDERS_INTERVAL", "300"))

# Rappels selon la récurrence : une tâche quotidienne ne prévient que le jour même
KINDS: dict[str | None, tuple[str, ...]] = {
    None: ("j3", "j1", "j0"),
    "monthly": ("j3", "j1", "j0"),
    "weekly": ("j1", "j0"),
    "daily": ("j0",),
}
MORNING_J3_J1 = (9, 0)   # rappels J-3 et J-1 à 9 h
MORNING_J0 = (8, 0)      # jour même sans heure : 8 h ; avec heure : 1 h avant

JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]
MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]


def public_key() -> str | None:
    return os.getenv("VAPID_PUBLIC_KEY") or None


def enabled() -> bool:
    return bool(os.getenv("VAPID_PUBLIC_KEY") and os.getenv("VAPID_PRIVATE_KEY"))


def now_local() -> datetime:
    """Heure locale (Europe/Paris), sans fuseau, pour comparer aux dates / heures des tâches."""
    return datetime.now(TZ).replace(tzinfo=None)


def _utc_to_local(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc).astimezone(TZ).replace(tzinfo=None)


def send(db: Session, sub: PushSubscription, payload: dict) -> bool:
    """Envoie à un appareil ; supprime l'abonnement si le navigateur l'a révoqué. Renvoie True si envoyé."""
    from pywebpush import WebPushException, webpush

    try:
        webpush(
            subscription_info={"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
            data=json.dumps(payload),
            vapid_private_key=os.environ["VAPID_PRIVATE_KEY"],
            vapid_claims={"sub": os.getenv("VAPID_SUBJECT", "mailto:admin@frigood.app")},
            ttl=12 * 3600,
        )
        return True
    except WebPushException as e:
        status = getattr(e.response, "status_code", None)
        if status in (404, 410):
            log.info("Abonnement expiré supprimé (%s)", status)
            db.delete(sub)
            db.commit()
        else:
            log.warning("Échec d'envoi push (%s) : %s", status, e)
        return False


def send_to_user(db: Session, user_id: int, payload: dict) -> int:
    subs = db.query(PushSubscription).filter_by(user_id=user_id).all()
    return sum(send(db, s, payload) for s in subs)


# --- Rappels des tâches importantes ---

def reminder_time(kind: str, d: date, heure: str | None) -> datetime:
    if kind == "j3":
        return datetime.combine(d - timedelta(days=3), datetime.min.time()).replace(hour=MORNING_J3_J1[0], minute=MORNING_J3_J1[1])
    if kind == "j1":
        return datetime.combine(d - timedelta(days=1), datetime.min.time()).replace(hour=MORNING_J3_J1[0], minute=MORNING_J3_J1[1])
    if heure:
        hh, mm = (int(x) for x in heure.split(":"))
        at = datetime.combine(d, datetime.min.time()).replace(hour=hh, minute=mm)
        return max(at - timedelta(hours=1), datetime.combine(d, datetime.min.time()))
    return datetime.combine(d, datetime.min.time()).replace(hour=MORNING_J0[0], minute=MORNING_J0[1])


def _date_fr(d: date) -> str:
    return f"{JOURS[d.weekday()]} {d.day} {MOIS[d.month - 1]}"


def reminder_payload(task: Task, d: date, kind: str) -> dict:
    when = {"j3": "Dans 3 jours", "j1": "Demain", "j0": "Aujourd'hui"}[kind]
    body = _date_fr(d).capitalize() + (f" à {task.heure}" if task.heure else "")
    if task.notes:
        body += f" · {task.notes}"
    return {
        "title": f"⭐ {when} : {task.titre}",
        "body": body,
        "url": f"/?jour={d.isoformat()}",
        "tag": f"task-{task.id}-{d.isoformat()}",
    }


def due_reminders(db: Session, now: datetime) -> list[tuple[Task, date, str | None, list[str]]]:
    """(tâche, date, rappel à envoyer ou None, rappels à marquer comme traités) pour les occurrences importantes à faire."""
    from app.routers.tasks import occurrences

    today = now.date()
    horizon = today + timedelta(days=3)
    tasks = db.query(Task).filter(Task.important.is_(True), Task.date <= horizon).all()
    out = []
    for t in tasks:
        created = _utc_to_local(t.created_at) if t.created_at else None
        for d in occurrences(t, today, horizon):
            # Moment de la tâche passé : plus la peine de prévenir
            if t.heure and now >= reminder_time("j0", d, t.heure) + timedelta(hours=1):
                continue
            due = [
                k for k in KINDS.get(t.recurrence, KINDS[None])
                if now >= reminder_time(k, d, t.heure) and (created is None or reminder_time(k, d, t.heure) >= created)
            ]
            if not due:
                continue
            if db.query(TaskCompletion).filter_by(task_id=t.id, date=d).first():
                continue  # faite ou pas faite : tranchée
            if t.activity_type_id and db.query(Activity).filter_by(
                    user_id=t.user_id, activity_type_id=t.activity_type_id, date=d).first():
                continue  # tâche sportive déjà validée par l'activité
            sent = {r.kind for r in db.query(TaskReminder).filter_by(task_id=t.id, date=d)}
            pending = [k for k in due if k not in sent]
            if not pending:
                continue
            # Un rappel ne part que le jour prévu (« Demain » le jour même n'aurait pas de sens) ;
            # ceux dont le jour est passé (serveur arrêté…) sont seulement marqués comme traités
            latest = pending[-1]
            send_kind = latest if reminder_time(latest, d, t.heure).date() == today else None
            out.append((t, d, send_kind, pending))
    return out


def run_reminders(db: Session, now: datetime | None = None) -> int:
    if not enabled():
        return 0
    now = now or now_local()
    sent = 0
    for task, d, kind, kinds in due_reminders(db, now):
        # Réservé avant l'envoi : même lancé deux fois en parallèle, un rappel ne part qu'une fois
        try:
            for k in kinds:
                db.add(TaskReminder(task_id=task.id, date=d, kind=k))
            db.commit()
        except IntegrityError:
            db.rollback()
            continue
        if kind:
            sent += send_to_user(db, task.user_id, reminder_payload(task, d, kind))
    return sent


def start_scheduler():
    """Vérifie les rappels toutes les REMINDERS_INTERVAL secondes, dans un fil d'arrière-plan de l'API."""
    if not enabled() or os.getenv("REMINDERS", "on") == "off":
        log.info("Rappels désactivés (clés VAPID absentes ou REMINDERS=off)")
        return
    from app.database import SessionLocal

    def loop():
        while True:
            try:
                with SessionLocal() as db:
                    n = run_reminders(db)
                    if n:
                        log.info("%d rappel(s) envoyé(s)", n)
            except Exception:
                log.exception("Erreur pendant l'envoi des rappels")
            time.sleep(INTERVAL_S)

    threading.Thread(target=loop, name="frigood-reminders", daemon=True).start()
    log.info("Rappels actifs (toutes les %d s)", INTERVAL_S)
