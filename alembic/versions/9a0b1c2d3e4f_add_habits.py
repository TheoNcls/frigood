"""habitudes (piano, méditation, lecture…) : jours prévus, jours faits, et préférence d'affichage de l'onglet

Revision ID: 9a0b1c2d3e4f
Revises: f8a9b0c1d2e3
Create Date: 2026-11-07 10:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "9a0b1c2d3e4f"
down_revision: Union[str, None] = "f8a9b0c1d2e3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("habitudes_active", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_table(
        "habits",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("nom", sa.String(80), nullable=False),
        sa.Column("emoji", sa.String(16), nullable=True),
        sa.Column("jours", sa.String(7), nullable=False, server_default="0123456"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.create_index("ix_habits_user_id", "habits", ["user_id"])
    op.create_table(
        "habit_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("habit_id", sa.Integer(), sa.ForeignKey("habits.id", ondelete="CASCADE"), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("done_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("habit_id", "date", name="uq_habit_log_day"),
    )
    op.create_index("ix_habit_logs_habit_id", "habit_logs", ["habit_id"])


def downgrade() -> None:
    op.drop_index("ix_habit_logs_habit_id", "habit_logs")
    op.drop_table("habit_logs")
    op.drop_index("ix_habits_user_id", "habits")
    op.drop_table("habits")
    op.drop_column("users", "habitudes_active")
