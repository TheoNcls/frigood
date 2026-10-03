"""bilans du coach : semaine préparée (le week-end, la semaine suivante)

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-10-03 16:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Anciens bilans : laissés vides, rattachés à la semaine où ils ont été faits par l'application
    op.add_column("coach_reports", sa.Column("semaine_cible", sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column("coach_reports", "semaine_cible")
