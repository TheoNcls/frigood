"""coach IA : plus d'exception pour l'administration, qui garde l'accès (activé sur son propre compte)

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-10-08 18:00:00.000000

"""
import os
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "f2a3b4c5d6e7"
down_revision: Union[str, None] = "e1f2a3b4c5d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Les comptes admin avaient l'accès d'office : on l'active sur leur compte pour qu'ils ne le perdent pas
    admins = [e.strip().lower() for e in os.getenv("ADMIN_EMAILS", "").split(",") if e.strip()]
    if admins:
        users = sa.table("users", sa.column("email", sa.String()), sa.column("coach_autorise", sa.Boolean()))
        op.execute(users.update().where(sa.func.lower(users.c.email).in_(admins)).values(coach_autorise=True))


def downgrade() -> None:
    pass  # l'accès accordé reste accordé
