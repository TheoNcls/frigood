"""accès au coach IA (activé par l'administration) et synchro Garmin à l'ouverture de l'appli

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-10-06 10:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "f6a7b8c9d0e1"
down_revision: Union[str, None] = "e5f6a7b8c9d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Personne n'est autorisé au départ (l'administration a toujours accès)
    op.add_column("users", sa.Column("coach_autorise", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("users", sa.Column("garmin_open_try_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "garmin_open_try_at")
    op.drop_column("users", "coach_autorise")
