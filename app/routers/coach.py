import json
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app import coach
from app.auth import Principal, check_user_access, get_principal
from app.database import get_db
from app.models import CoachReport, User
from app.push_service import now_local
from app.schemas import CoachReportRead

router = APIRouter(tags=["coach"], dependencies=[Depends(get_principal)])

COOLDOWN = timedelta(seconds=60)   # évite les doubles demandes (chaque bilan coûte un appel à Claude)


def _user(db: Session, user_id: int, principal: Principal) -> User:
    check_user_access(principal, user_id)
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    return user


@router.get("/users/{user_id}/coach/", response_model=CoachReportRead | None)
def last_report(user_id: int, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    _user(db, user_id, principal)
    return (db.query(CoachReport).filter_by(user_id=user_id)
            .order_by(CoachReport.created_at.desc(), CoachReport.id.desc()).first())


@router.get("/users/{user_id}/coach/context")
def preview_context(user_id: int, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """Les données qui seraient envoyées au coach, pour vérifier ce qu'il voit."""
    user = _user(db, user_id, principal)
    return coach.build_context(db, user, now_local().date())


@router.post("/users/{user_id}/coach/", response_model=CoachReportRead)
def new_report(user_id: int, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    user = _user(db, user_id, principal)
    last = (db.query(CoachReport).filter_by(user_id=user_id).order_by(CoachReport.created_at.desc()).first())
    if last and last.created_at and datetime.utcnow() - last.created_at < COOLDOWN:
        raise HTTPException(status_code=429, detail="Un bilan vient d'être fait, attends une minute avant d'en redemander un")

    context = coach.build_context(db, user, now_local().date())
    try:
        texte, usage = coach.ask_claude(context)
    except coach.CoachError as e:
        raise HTTPException(status_code=502, detail=str(e))
    report = CoachReport(
        user_id=user_id, texte=texte, model=usage.get("model"),
        input_tokens=usage.get("input_tokens"), output_tokens=usage.get("output_tokens"),
        contexte=json.dumps(context, ensure_ascii=False, default=str),
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return report
