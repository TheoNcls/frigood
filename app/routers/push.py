from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from app import push_service
from app.auth import Principal, check_user_access, get_principal
from app.database import get_db
from app.models import PushSubscription
from app.schemas import PushSubscriptionIn

router = APIRouter(tags=["push"], dependencies=[Depends(get_principal)])


@router.get("/push/config")
def push_config():
    """Clé publique VAPID pour abonner un appareil (null si les notifications ne sont pas configurées)."""
    return {"public_key": push_service.public_key(), "enabled": push_service.enabled()}


@router.post("/users/{user_id}/push/subscriptions")
def subscribe(user_id: int, data: PushSubscriptionIn, request: Request,
              principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    check_user_access(principal, user_id)
    sub = db.query(PushSubscription).filter_by(endpoint=data.endpoint).first()
    if not sub:
        sub = PushSubscription(endpoint=data.endpoint)
        db.add(sub)
    # Un appareil réabonné (ou passé à un autre compte) garde une seule ligne
    sub.user_id = user_id
    sub.p256dh = data.keys.p256dh
    sub.auth = data.keys.auth
    sub.user_agent = (request.headers.get("user-agent") or "")[:300] or None
    db.commit()
    return {"message": "Notifications activées sur cet appareil"}


@router.post("/users/{user_id}/push/unsubscribe")
def unsubscribe(user_id: int, data: dict, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    check_user_access(principal, user_id)
    db.query(PushSubscription).filter_by(user_id=user_id, endpoint=data.get("endpoint", "")).delete()
    db.commit()
    return {"message": "Notifications désactivées sur cet appareil"}


@router.get("/users/{user_id}/push/subscriptions")
def list_subscriptions(user_id: int, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    check_user_access(principal, user_id)
    return [
        {"id": s.id, "user_agent": s.user_agent, "created_at": s.created_at}
        for s in db.query(PushSubscription).filter_by(user_id=user_id).order_by(PushSubscription.created_at)
    ]


@router.post("/users/{user_id}/push/test")
def send_test(user_id: int, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    check_user_access(principal, user_id)
    if not push_service.enabled():
        raise HTTPException(status_code=503, detail="Notifications non configurées sur le serveur (clés VAPID)")
    sent = push_service.send_to_user(db, user_id, {
        "title": "🔔 Frigood",
        "body": "Les notifications fonctionnent sur cet appareil !",
        "url": "/",
        "tag": "test",
    })
    if not sent:
        raise HTTPException(status_code=404, detail="Aucun appareil abonné n'a pu être joint")
    return {"sent": sent}
