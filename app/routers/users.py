from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
import bcrypt
from app.database import get_db
from app.models import User
from app.schemas import UserCreate, UserUpdate, UserRead, UserLogin, ChangePassword
from app.auth import verify_api_key

router = APIRouter(prefix="/users", tags=["users"], dependencies=[Depends(verify_api_key)])


def _hash(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def _verify(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


@router.post("/", response_model=UserRead)
def register(data: UserCreate, db: Session = Depends(get_db)):
    user = User(
        nom=data.nom,
        email=data.email,
        password_hash=_hash(data.password),
        calories_cible=data.calories_cible,
        proteines_cible=data.proteines_cible,
        glucides_cible=data.glucides_cible,
        lipides_cible=data.lipides_cible,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Un compte avec l'email « {data.email} » existe déjà")
    db.refresh(user)
    return user


@router.post("/login", response_model=UserRead)
def login(data: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter_by(email=data.email).first()
    if not user or not _verify(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email ou mot de passe incorrect")
    return user


@router.get("/", response_model=list[UserRead])
def list_users(db: Session = Depends(get_db)):
    return db.query(User).order_by(User.nom).all()


@router.get("/{id}", response_model=UserRead)
def get_user(id: int, db: Session = Depends(get_db)):
    user = db.get(User, id)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    return user


@router.put("/{id}", response_model=UserRead)
def update_user(id: int, data: UserUpdate, db: Session = Depends(get_db)):
    user = db.get(User, id)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    for key, value in data.model_dump(exclude_none=True).items():
        setattr(user, key, value)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/{id}")
def delete_user(id: int, db: Session = Depends(get_db)):
    user = db.get(User, id)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    db.delete(user)
    db.commit()
    return {"message": "Compte supprimé"}


@router.post("/{id}/change_password")
def change_password(id: int, data: ChangePassword, db: Session = Depends(get_db)):
    user = db.get(User, id)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    if not _verify(data.old_password, user.password_hash):
        raise HTTPException(status_code=401, detail="Mot de passe actuel incorrect")
    user.password_hash = _hash(data.new_password)
    db.commit()
    return {"message": "Mot de passe changé"}
