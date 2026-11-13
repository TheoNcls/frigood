"""Créateur de séances : la séance décrite par la personne, construite par Claude (comptes avec le coach IA)
ou par une autre IA (copier-coller). Elle remplit le formulaire de tâche ; rien n'est enregistré ici."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import workout_creator
from app.auth import Principal, check_user_access, get_principal
from app.coach import CoachError
from app.database import get_db
from app.garmin_workouts import exercises_for
from app.models import ActivityType, User
from app.push_service import now_local
from app.routers.coach import COACH_NON_AUTORISE
from app.schemas import CoachManualIn, WorkoutDraft

router = APIRouter(tags=["workout_creator"], dependencies=[Depends(get_principal)])


def _user(db: Session, user_id: int, principal: Principal) -> User:
    check_user_access(principal, user_id)
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    return user


def _sport(db: Session, activity_type_id: int | None) -> ActivityType | None:
    if activity_type_id is None:
        return None
    sport = db.get(ActivityType, activity_type_id)
    if not sport:
        raise HTTPException(status_code=400, detail="Type d'activité inconnu")
    return sport


def _context(db: Session, user: User, draft: WorkoutDraft) -> tuple[dict, ActivityType | None]:
    sport = _sport(db, draft.activity_type_id)
    return workout_creator.build_context(db, user, draft.model_dump(), sport, now_local().date()), sport


@router.post("/users/{user_id}/workout_creator/ai")
def create_with_claude(user_id: int, draft: WorkoutDraft, principal: Principal = Depends(get_principal),
                       db: Session = Depends(get_db)):
    """Claude construit la séance (comptes avec le coach IA : chaque appel est payant)."""
    user = _user(db, user_id, principal)
    if not principal.is_service and not user.coach_access:
        raise HTTPException(status_code=403, detail=COACH_NON_AUTORISE)
    context, sport = _context(db, user, draft)
    try:
        proposal, _usage = workout_creator.ask_claude(context, db.query(ActivityType).all(), sport, user.materiel)
    except CoachError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return proposal


@router.post("/users/{user_id}/workout_creator/prompt")
def prompt_for_other_ai(user_id: int, draft: WorkoutDraft, principal: Principal = Depends(get_principal),
                        db: Session = Depends(get_db)):
    """Le texte qu'aurait reçu Claude, à coller dans une autre IA (ouvert à tous : aucun coût)."""
    user = _user(db, user_id, principal)
    context, _ = _context(db, user, draft)
    sports = sorted(t.nom for t in db.query(ActivityType).all()) or ["Course à pied"]
    return {"texte": workout_creator.external_prompt(context, sports, exercises_for(user.materiel))}


@router.post("/users/{user_id}/workout_creator/parse")
def parse_other_ai(user_id: int, data: CoachManualIn, activity_type_id: int | None = None,
                   principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """Relit la réponse collée d'une autre IA : la même proposition que Claude, pour remplir le formulaire."""
    _user(db, user_id, principal)
    try:
        return workout_creator.parse_external(data.texte, db.query(ActivityType).all(), _sport(db, activity_type_id))
    except CoachError as e:
        raise HTTPException(status_code=400, detail=str(e))
