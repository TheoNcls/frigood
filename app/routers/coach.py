import json
from datetime import date, datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app import coach, plan
from app.garmin_workouts import exercises_for
from app.auth import Principal, check_user_access, get_principal
from app.database import get_db
from app.models import ActivityType, CoachReport, Task, User
from app.push_service import local_date, now_local
from app.schemas import CoachActivitiesAdd, CoachReportRead, UserRead

router = APIRouter(tags=["coach"], dependencies=[Depends(get_principal)])



def _target_of(report: CoachReport) -> date | None:
    """Semaine préparée par un bilan (anciens bilans : la semaine où ils ont été faits)."""
    if report.semaine_cible:
        return report.semaine_cible
    if report.created_at:
        d = local_date(report.created_at)
        return d - timedelta(days=d.weekday())
    return None


def _targets(db: Session, user_id: int) -> set:
    """Semaines déjà préparées (anciens bilans sans semaine : la semaine où ils ont été faits)."""
    out = set()
    for semaine_cible, created_at in db.query(CoachReport.semaine_cible, CoachReport.created_at).filter_by(user_id=user_id):
        if semaine_cible:
            out.add(semaine_cible)
        elif created_at:
            d = local_date(created_at)
            out.add(d - timedelta(days=d.weekday()))
    return out


def _user(db: Session, user_id: int, principal: Principal) -> User:
    check_user_access(principal, user_id)
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    _check_coach_access(principal, user)
    return user

COACH_NON_AUTORISE = "Le coach IA n'est pas encore activé pour ton compte : demande l'accès à l'administrateur."


def _check_coach_access(principal: Principal, user: User):
    if not principal.is_service and not user.coach_access:
        raise HTTPException(status_code=403, detail=COACH_NON_AUTORISE)



@router.get("/users/{user_id}/coach/", response_model=CoachReportRead | None)
def last_report(user_id: int, semaine_du: date | None = Query(default=None),
                principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """Dernier bilan, ou celui qui prépare la semaine du lundi `semaine_du`."""
    _user(db, user_id, principal)
    reports = (db.query(CoachReport).filter_by(user_id=user_id)
               .order_by(CoachReport.created_at.desc(), CoachReport.id.desc()))
    if semaine_du is None:
        return reports.first()
    return next((r for r in reports if _target_of(r) == semaine_du), None)


@router.get("/users/{user_id}/coach/weeks")
def prepared_weeks(user_id: int, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """Lundis des semaines déjà préparées par un bilan."""
    _user(db, user_id, principal)
    return sorted(d.isoformat() for d in _targets(db, user_id))


@router.get("/users/{user_id}/coach/context")
def preview_context(user_id: int, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """Les données qui seraient envoyées au coach, pour vérifier ce qu'il voit."""
    user = _user(db, user_id, principal)
    return coach.build_context(db, user, now_local().date())


@router.post("/users/{user_id}/coach/", response_model=CoachReportRead)
def new_report(user_id: int, semaine: str = Query(default="courante", pattern="^(courante|prochaine)$"),
               principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """Bilan et séances pour la semaine en cours, ou (le week-end seulement) pour la semaine prochaine."""
    user = _user(db, user_id, principal)
    today = now_local().date()
    next_week = semaine == "prochaine"
    if next_week and not coach.is_weekend(today):
        raise HTTPException(status_code=400, detail="La semaine prochaine se prépare le week-end (samedi ou dimanche)")
    week = coach.week_window(today, next_week)
    target = week[0] - timedelta(days=week[0].weekday())   # lundi de la semaine préparée
    if target in _targets(db, user_id):
        # Un bilan par semaine préparée (chaque bilan coûte un appel à Claude)
        label = "la semaine prochaine" if next_week else "cette semaine"
        raise HTTPException(
            status_code=409,
            detail=f"Tu as déjà fait ton bilan pour {label} (semaine du lundi {target:%d/%m}). "
                   + ("" if next_week else f"Prochain bilan possible le week-end pour la semaine du {target + timedelta(days=7):%d/%m}."),
        )

    context = coach.build_context(db, user, today)
    sports = [t.nom for t in db.query(ActivityType).all()]
    try:
        result, usage = coach.ask_claude(context, sports, week, exercises_for(user.materiel))
    except coach.CoachError as e:
        raise HTTPException(status_code=502, detail=str(e))
    report = CoachReport(
        user_id=user_id, texte=coach.to_markdown(result), donnees=json.dumps(result, ensure_ascii=False),
        model=usage.get("model"), input_tokens=usage.get("input_tokens"), output_tokens=usage.get("output_tokens"),
        contexte=json.dumps(context, ensure_ascii=False, default=str), semaine_cible=target,
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return report


@router.post("/users/{user_id}/plan", response_model=UserRead)
def generate_plan(user_id: int, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """Plan à long terme vers les objectifs, écrit par le coach. Une seule fois (l'administration peut en autoriser
    une nouvelle) : ensuite on le modifie à la main. Une nouvelle génération remplace le texte."""
    user = _user(db, user_id, principal)
    if user.plan_genere_at:
        raise HTTPException(status_code=409, detail="Ton plan a déjà été généré : modifie-le directement "
                                                    "(ou demande à l'administrateur d'en autoriser un nouveau)")
    if not (user.profil_coaching or "").strip():
        raise HTTPException(status_code=400, detail="Écris d'abord tes objectifs dans « Mes infos & objectifs »")
    context = plan.build_plan_context(db, user, now_local().date())
    try:
        text, usage = plan.ask_plan(context)
    except coach.CoachError as e:
        raise HTTPException(status_code=502, detail=str(e))
    user.plan_objectifs = text
    user.plan_genere_at = datetime.utcnow()
    db.commit()
    db.refresh(user)
    return user


@router.get("/users/{user_id}/plan/jalon")
def plan_milestone(user_id: int, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    """Jalon du mois en cours (lu dans le plan) et où on en est cette semaine : pour l'accueil."""
    check_user_access(principal, user_id)
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    return plan.current_milestone(db, user, now_local().date())


@router.post("/coach/{report_id}/activities")
def add_activities(report_id: int, data: CoachActivitiesAdd, principal: Principal = Depends(get_principal),
                   db: Session = Depends(get_db)):
    """Ajoute à l'agenda les séances conseillées par le coach (tâches sportives, marquées « coach »)."""
    report = db.get(CoachReport, report_id)
    if not report:
        raise HTTPException(status_code=404, detail="Bilan introuvable")
    check_user_access(principal, report.user_id)
    _check_coach_access(principal, db.get(User, report.user_id))
    if report.activites_ajoutees_at:
        raise HTTPException(status_code=409, detail="Les activités de ce bilan sont déjà dans l'agenda")
    proposals = (json.loads(report.donnees) if report.donnees else {}).get("activites") or []
    chosen = proposals if data.indexes is None else [proposals[i] for i in data.indexes if 0 <= i < len(proposals)]
    today = now_local().date()
    types = {t.nom: t.id for t in db.query(ActivityType).all()}
    added = skipped = 0
    for a in chosen:
        d = date.fromisoformat(a["date"])
        if d < today or a["sport"] not in types:
            skipped += 1  # jour passé depuis le bilan, ou sport supprimé
            continue
        notes = a.get("details") or None
        if a.get("duree_min") and notes:
            notes = f"{a['duree_min']} min · {notes}"
        db.add(Task(user_id=report.user_id, titre=a["titre"][:200], date=d, notes=notes,
                    activity_type_id=types[a["sport"]], par_coach=True,
                    seance=json.dumps(a["etapes"], ensure_ascii=False) if a.get("etapes")
                    else json.dumps({"exercices": a["exercices"]}, ensure_ascii=False) if a.get("exercices") else None))
        added += 1
    report.activites_ajoutees_at = datetime.utcnow()
    db.commit()
    return {"added": added, "skipped": skipped}
