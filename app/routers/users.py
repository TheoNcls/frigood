from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
import bcrypt
from app.database import get_db
from app.models import User
from app.schemas import UserCreate, UserUpdate, UserRead, UserWithToken, UserLogin, ChangePassword
from app.auth import Principal, get_principal, require_admin, check_user_access, create_token

router = APIRouter(prefix="/users", tags=["users"])


def _hash(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def _verify(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def _with_token(user: User) -> UserWithToken:
    return UserWithToken(**UserRead.model_validate(user).model_dump(), access_token=create_token(user.id))


def _get_user(db: Session, id: int) -> User:
    user = db.get(User, id)
    if not user:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    return user


@router.post("/", response_model=UserWithToken)
def register(data: UserCreate, db: Session = Depends(get_db)):
    if len(data.password) < 8:
        raise HTTPException(status_code=400, detail="Le mot de passe doit faire au moins 8 caractères")
    if db.query(User).filter(func.lower(User.email) == data.email.strip().lower()).first():
        raise HTTPException(status_code=400, detail=f"Un compte avec l'email « {data.email} » existe déjà")
    user = User(
        nom=data.nom,
        email=data.email.strip().lower(),
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
    return _with_token(user)


@router.post("/login", response_model=UserWithToken)
def login(data: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(func.lower(User.email) == data.email.strip().lower()).first()
    if not user or not _verify(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email ou mot de passe incorrect")
    return _with_token(user)


@router.get("/", response_model=list[UserRead], dependencies=[Depends(require_admin)])
def list_users(db: Session = Depends(get_db)):
    return db.query(User).order_by(User.nom).all()


@router.get("/me", response_model=UserRead)
def get_me(principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    if principal.user_id is None:
        raise HTTPException(status_code=400, detail="Aucun utilisateur associé à cette authentification")
    return _get_user(db, principal.user_id)


@router.get("/{id}", response_model=UserRead)
def get_user(id: int, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    check_user_access(principal, id)
    return _get_user(db, id)


@router.put("/{id}", response_model=UserRead)
def update_user(id: int, data: UserUpdate, principal: Principal = Depends(get_principal),
                db: Session = Depends(get_db)):
    check_user_access(principal, id)
    user = _get_user(db, id)
    for key, value in data.model_dump(exclude_none=True).items():
        setattr(user, key, value)
    db.commit()
    db.refresh(user)
    return user


@router.delete("/{id}")
def delete_user(id: int, principal: Principal = Depends(get_principal), db: Session = Depends(get_db)):
    check_user_access(principal, id)
    db.delete(_get_user(db, id))
    db.commit()
    return {"message": "Compte supprimé"}


@router.post("/{id}/change_password")
def change_password(id: int, data: ChangePassword, principal: Principal = Depends(get_principal),
                    db: Session = Depends(get_db)):
    check_user_access(principal, id)
    user = _get_user(db, id)
    if not _verify(data.old_password, user.password_hash):
        raise HTTPException(status_code=401, detail="Mot de passe actuel incorrect")
    if len(data.new_password) < 8:
        raise HTTPException(status_code=400, detail="Le mot de passe doit faire au moins 8 caractères")
    user.password_hash = _hash(data.new_password)
    db.commit()
    return {"message": "Mot de passe changé"}
