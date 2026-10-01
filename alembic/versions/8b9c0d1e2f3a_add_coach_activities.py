"""coach : bilan structuré, activités ajoutées à l'agenda (tâches marquées « coach »)

Revision ID: 8b9c0d1e2f3a
Revises: 7a8b9c0d1e2f
Create Date: 2026-10-06 10:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "8b9c0d1e2f3a"
down_revision: Union[str, None] = "7a8b9c0d1e2f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("par_coach", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("coach_reports", sa.Column("donnees", sa.Text(), nullable=True))
    op.add_column("coach_reports", sa.Column("activites_ajoutees_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("coach_reports", "activites_ajoutees_at")
    op.drop_column("coach_reports", "donnees")
    op.drop_column("tasks", "par_coach")
