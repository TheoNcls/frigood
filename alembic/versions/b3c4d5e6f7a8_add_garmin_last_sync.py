"""utilisateurs : résumé de la dernière synchro Garmin (manuelle ou automatique)

Revision ID: b3c4d5e6f7a8
Revises: a2b3c4d5e6f7
Create Date: 2026-10-01 18:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "b3c4d5e6f7a8"
down_revision: Union[str, None] = "a2b3c4d5e6f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COLUMNS = [
    sa.Column("garmin_last_sync_at", sa.DateTime(), nullable=True),
    sa.Column("garmin_last_sync_auto", sa.Boolean(), nullable=True),
    sa.Column("garmin_last_sync_activities", sa.Integer(), nullable=True),
    sa.Column("garmin_last_sync_days", sa.Integer(), nullable=True),
]


def upgrade() -> None:
    for column in COLUMNS:
        op.add_column("users", column)
    # Comptes déjà synchronisés : dernière mise à jour connue = dernière journée santé récupérée
    op.execute("""
        UPDATE users SET garmin_last_sync_at = (
            SELECT MAX(d.synced_at) FROM daily_stats d WHERE d.user_id = users.id
        )
        WHERE garmin_tokens IS NOT NULL
    """)


def downgrade() -> None:
    for column in reversed(COLUMNS):
        op.drop_column("users", column.name)
