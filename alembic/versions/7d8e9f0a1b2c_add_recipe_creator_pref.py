"""préférence : onglet Créateur de recettes

Revision ID: 7d8e9f0a1b2c
Revises: 8c9d0e1f2a3b
Create Date: 2026-11-07 20:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "7d8e9f0a1b2c"
down_revision: Union[str, None] = "8c9d0e1f2a3b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("createur_recette_active", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("users", "createur_recette_active")
