import hmac
import os
import time
from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, Security
from fastapi.security import APIKeyHeader, HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)
bearer_scheme = HTTPBearer(auto_error=False)

TOKEN_TTL_SECONDS = 30 * 24 * 3600
JWT_ALGORITHM = "HS256"


@dataclass
class Principal:
    # Clé API (scripts, maintenance) : accès complet, y compris aux données de tous les utilisateurs
    is_service: bool
    user_id: int | None = None
    # Utilisateur listé dans ADMIN_EMAILS : gère le catalogue, mais ne voit que ses propres données
    is_admin: bool = False


def _jwt_secret() -> str:
    secret = os.getenv("JWT_SECRET")
    if not secret:
        raise HTTPException(status_code=500, detail="JWT_SECRET non configurée")
    return secret


def create_token(user_id: int) -> str:
    payload = {"sub": str(user_id), "exp": int(time.time()) + TOKEN_TTL_SECONDS}
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGORITHM)


def get_principal(
    api_key: str | None = Security(api_key_header),
    bearer: HTTPAuthorizationCredentials | None = Security(bearer_scheme),
    db: Session = Depends(get_db),
) -> Principal:
    expected = os.getenv("API_KEY")
    if api_key:
        if expected and hmac.compare_digest(api_key, expected):
            return Principal(is_service=True, is_admin=True)
        raise HTTPException(status_code=403, detail="Clé API invalide")
    if bearer:
        try:
            payload = jwt.decode(bearer.credentials, _jwt_secret(), algorithms=[JWT_ALGORITHM])
            user_id = int(payload["sub"])
        except (jwt.PyJWTError, KeyError, ValueError):
            raise HTTPException(status_code=401, detail="Session expirée, reconnecte-toi")
        user = db.get(User, user_id)
        if not user:
            raise HTTPException(status_code=401, detail="Session expirée, reconnecte-toi")
        return Principal(is_service=False, user_id=user.id, is_admin=user.is_admin)
    raise HTTPException(status_code=401, detail="Authentification requise")


def require_admin(principal: Principal = Depends(get_principal)) -> Principal:
    if not principal.is_admin:
        raise HTTPException(status_code=403, detail="Réservé à l'administration")
    return principal


def require_service(principal: Principal = Depends(get_principal)) -> Principal:
    if not principal.is_service:
        raise HTTPException(status_code=403, detail="Réservé à l'administration")
    return principal


def check_user_access(principal: Principal, user_id: int | None):
    if not principal.is_service and principal.user_id != user_id:
        raise HTTPException(status_code=403, detail="Accès refusé")
