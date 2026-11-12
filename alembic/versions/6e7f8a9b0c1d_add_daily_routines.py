"""habitudes journalières : rappels à heures fixes certains jours (notifications)

Revision ID: 6e7f8a9b0c1d
Revises: 7d8e9f0a1b2c
Create Date: 2026-11-12 10:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "6e7f8a9b0c1d"
down_revision: Union[str, None] = "7d8e9f0a1b2c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "daily_routines",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("nom", sa.String(80), nullable=False),
        sa.Column("jours", sa.String(7), nullable=False, server_default="01234"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.create_index("ix_daily_routines_user_id", "daily_routines", ["user_id"])
    op.create_table(
        "routine_reminders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("routine_id", sa.Integer(), sa.ForeignKey("daily_routines.id", ondelete="CASCADE"), nullable=False),
        sa.Column("heure", sa.String(5), nullable=False),
        sa.Column("message", sa.String(200), nullable=False),
        sa.Column("envoye_le", sa.Date(), nullable=True),
    )
    op.create_index("ix_routine_reminders_routine_id", "routine_reminders", ["routine_id"])


def downgrade() -> None:
    op.drop_index("ix_routine_reminders_routine_id", "routine_reminders")
    op.drop_table("routine_reminders")
    op.drop_index("ix_daily_routines_user_id", "daily_routines")
    op.drop_table("daily_routines")
