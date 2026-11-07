"""habitudes : objectif « X fois par semaine » et rappel par notification à une heure choisie

Revision ID: 8c9d0e1f2a3b
Revises: 9a0b1c2d3e4f
Create Date: 2026-11-07 18:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "8c9d0e1f2a3b"
down_revision: Union[str, None] = "9a0b1c2d3e4f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("habits", sa.Column("objectif_semaine", sa.Integer(), nullable=True))
    op.add_column("habits", sa.Column("rappel_heure", sa.String(5), nullable=True))
    op.add_column("habits", sa.Column("rappel_envoye_le", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("habits", "rappel_envoye_le")
    op.drop_column("habits", "rappel_heure")
    op.drop_column("habits", "objectif_semaine")
