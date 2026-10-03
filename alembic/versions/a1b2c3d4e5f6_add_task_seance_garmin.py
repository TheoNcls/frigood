"""séances structurées envoyées sur la montre, zones cardiaques Garmin

Revision ID: a1b2c3d4e5f6
Revises: 9c0d1e2f3a4b
Create Date: 2026-10-03 10:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "9c0d1e2f3a4b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("seance", sa.Text(), nullable=True))
    op.add_column("tasks", sa.Column("garmin_workout_id", sa.String(40), nullable=True))
    op.add_column("tasks", sa.Column("garmin_schedule_id", sa.String(40), nullable=True))
    op.add_column("tasks", sa.Column("garmin_envoye_at", sa.DateTime(), nullable=True))
    op.add_column("users", sa.Column("garmin_zones_fc", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("garmin_zones_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "garmin_zones_at")
    op.drop_column("users", "garmin_zones_fc")
    op.drop_column("tasks", "garmin_envoye_at")
    op.drop_column("tasks", "garmin_schedule_id")
    op.drop_column("tasks", "garmin_workout_id")
    op.drop_column("tasks", "seance")
