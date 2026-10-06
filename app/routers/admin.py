from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.auth import require_admin
from app.database import get_db
from app.models import CoachReport, User
from app.schemas import AdminUserRead, AdminUserUpdate

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


def _read(user: User, stats: dict) -> AdminUserRead:
    n, last = stats.get(user.id, (0, None))
    return AdminUserRead.model_validate(user).model_copy(update={"bilans_coach": n, "dernier_bilan_at": last})


def _coach_stats(db: Session) -> dict:
    rows = db.query(CoachReport.user_id, func.count(CoachReport.id), func.max(CoachReport.created_at)).group_by(CoachReport.user_id)
    return {uid: (n, last) for uid, n, last in rows}


@router.get("/users", response_model=list[AdminUserRead])
def list_users(db: Session = Depends(get_db)):
    """Comptes, avec leur accès au coach IA et le nombre de bilans déjà faits."""
    stats = _coach_stats(db)
    return [_read(u, stats) for u in db.query(User).order_by(func.lower(User.nom), User.id)]


@router.put("/users/{user_id}", response_model=AdminUserRead)
def update_user(user_id: int, data: AdminUserUpdate, db: Session = Depends(get_db)):
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    if data.coach_autorise is not None:
        user.coach_autorise = data.coach_autorise
    db.commit()
    db.refresh(user)
    return _read(user, _coach_stats(db))
