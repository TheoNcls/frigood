"""utilisateurs : synchro Garmin automatique du matin (opt-in)

Revision ID: a2b3c4d5e6f7
Revises: f1a2b3c4d5e6
Create Date: 2026-10-01 10:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "a2b3c4d5e6f7"
down_revision: Union[str, None] = "f1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COLUMNS = [
    sa.Column("garmin_auto_sync", sa.Boolean(), nullable=False, server_default=sa.false()),
    sa.Column("garmin_auto_heure", sa.String(5), nullable=False, server_default="07:00"),
    sa.Column("garmin_auto_date", sa.Date(), nullable=True),
    sa.Column("garmin_auto_tries", sa.Integer(), nullable=False, server_default="0"),
    sa.Column("garmin_auto_next_at", sa.DateTime(), nullable=True),
    sa.Column("garmin_auto_status", sa.String(300), nullable=True),
    sa.Column("garmin_auto_last_at", sa.DateTime(), nullable=True),
]


def upgrade() -> None:
    for column in COLUMNS:
        op.add_column("users", column)


def downgrade() -> None:
    for column in reversed(COLUMNS):
        op.drop_column("users", column.name)
