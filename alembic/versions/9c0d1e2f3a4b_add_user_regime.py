"""utilisateurs : régime alimentaire (transmis au coach)

Revision ID: 9c0d1e2f3a4b
Revises: 8b9c0d1e2f3a
Create Date: 2026-10-07 10:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "9c0d1e2f3a4b"
down_revision: Union[str, None] = "8b9c0d1e2f3a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Comptes existants : végétarien (le public d'origine de Frigood)
    op.add_column("users", sa.Column("regime_alimentaire", sa.String(20), nullable=False, server_default="vegetarien"))


def downgrade() -> None:
    op.drop_column("users", "regime_alimentaire")
