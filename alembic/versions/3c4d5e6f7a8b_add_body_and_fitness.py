"""balance connectée (pesées), indicateurs de forme, objectif protéines en g/kg

Revision ID: 3c4d5e6f7a8b
Revises: 2b3c4d5e6f7a
Create Date: 2026-10-03 16:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "3c4d5e6f7a8b"
down_revision: Union[str, None] = "2b3c4d5e6f7a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("proteines_g_kg", sa.Float(), nullable=True))
    op.create_table(
        "body_compositions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("date", sa.Date(), nullable=False, index=True),
        sa.Column("mesure_at", sa.DateTime(), nullable=True),
        sa.Column("poids_kg", sa.Float(), nullable=False),
        sa.Column("imc", sa.Float(), nullable=True),
        sa.Column("masse_grasse_pct", sa.Float(), nullable=True),
        sa.Column("masse_musculaire_kg", sa.Float(), nullable=True),
        sa.Column("masse_osseuse_kg", sa.Float(), nullable=True),
        sa.Column("eau_pct", sa.Float(), nullable=True),
        sa.Column("graisse_viscerale", sa.Float(), nullable=True),
        sa.Column("age_metabolique", sa.Integer(), nullable=True),
        sa.Column("source", sa.String(10), nullable=False, server_default="garmin"),
        sa.Column("garmin_sample_pk", sa.String(40), nullable=True),
        sa.Column("raw_data", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("user_id", "garmin_sample_pk", name="uq_body_comp_sample"),
    )
    op.create_table(
        "fitness_metrics",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("readiness_score", sa.Integer(), nullable=True),
        sa.Column("readiness_niveau", sa.String(20), nullable=True),
        sa.Column("readiness_conseil", sa.String(80), nullable=True),
        sa.Column("statut_entrainement", sa.String(30), nullable=True),
        sa.Column("charge_aigue", sa.Integer(), nullable=True),
        sa.Column("charge_chronique", sa.Integer(), nullable=True),
        sa.Column("vo2max", sa.Float(), nullable=True),
        sa.Column("vo2max_velo", sa.Float(), nullable=True),
        sa.Column("prediction_5k_s", sa.Integer(), nullable=True),
        sa.Column("prediction_10k_s", sa.Integer(), nullable=True),
        sa.Column("prediction_semi_s", sa.Integer(), nullable=True),
        sa.Column("prediction_marathon_s", sa.Integer(), nullable=True),
        sa.Column("endurance_score", sa.Integer(), nullable=True),
        sa.Column("hill_score", sa.Integer(), nullable=True),
        sa.Column("age_forme", sa.Float(), nullable=True),
        sa.Column("raw_data", sa.Text(), nullable=True),
        sa.Column("synced_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("user_id", "date", name="uq_fitness_day"),
    )


def downgrade() -> None:
    op.drop_table("fitness_metrics")
    op.drop_table("body_compositions")
    op.drop_column("users", "proteines_g_kg")
