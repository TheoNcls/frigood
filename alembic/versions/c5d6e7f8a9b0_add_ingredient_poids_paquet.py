"""ingrédients : poids total à l'achat (paquet), pour ajouter « 1 paquet » au frigo

Revision ID: c5d6e7f8a9b0
Revises: b4c5d6e7f8a9
Create Date: 2026-10-09 10:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "c5d6e7f8a9b0"
down_revision: Union[str, None] = "b4c5d6e7f8a9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("ingredients", sa.Column("poids_paquet", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("ingredients", "poids_paquet")
