"""synchro Garmin du matin supprimée : garmin_auto_sync vaut maintenant pour la synchro à l'ouverture de l'appli

Revision ID: a7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-10-07 10:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "a7b8c9d0e1f2"
down_revision: Union[str, None] = "f6a7b8c9d0e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MORNING_COLUMNS = ("garmin_auto_heure", "garmin_auto_date", "garmin_auto_tries",
                   "garmin_auto_next_at", "garmin_auto_status", "garmin_auto_last_at")


def upgrade() -> None:
    for name in MORNING_COLUMNS:
        op.drop_column("users", name)
    # Synchro à l'ouverture : active pour tout le monde (comme jusqu'ici), chacun peut la couper dans son profil
    users = sa.table("users", sa.column("garmin_auto_sync", sa.Boolean()))
    op.execute(users.update().values(garmin_auto_sync=True))
    if op.get_bind().dialect.name != "sqlite":
        op.alter_column("users", "garmin_auto_sync", server_default=sa.true())


def downgrade() -> None:
    if op.get_bind().dialect.name != "sqlite":
        op.alter_column("users", "garmin_auto_sync", server_default=sa.false())
    op.add_column("users", sa.Column("garmin_auto_heure", sa.String(5), nullable=False, server_default="07:00"))
    op.add_column("users", sa.Column("garmin_auto_date", sa.Date(), nullable=True))
    op.add_column("users", sa.Column("garmin_auto_tries", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("users", sa.Column("garmin_auto_next_at", sa.DateTime(), nullable=True))
    op.add_column("users", sa.Column("garmin_auto_status", sa.String(300), nullable=True))
    op.add_column("users", sa.Column("garmin_auto_last_at", sa.DateTime(), nullable=True))
