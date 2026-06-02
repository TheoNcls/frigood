"""add daily_stats table

Revision ID: f7a8b9c0d1e2
Revises: e6f7a8b9c0d1
Create Date: 2026-06-02 12:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'f7a8b9c0d1e2'
down_revision: Union[str, Sequence[str], None] = 'e6f7a8b9c0d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'daily_stats',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('sommeil_total_h', sa.Float(), nullable=True),
        sa.Column('sommeil_profond_h', sa.Float(), nullable=True),
        sa.Column('sommeil_leger_h', sa.Float(), nullable=True),
        sa.Column('sommeil_rem_h', sa.Float(), nullable=True),
        sa.Column('sommeil_eveil_h', sa.Float(), nullable=True),
        sa.Column('sommeil_score', sa.Integer(), nullable=True),
        sa.Column('heure_coucher', sa.String(), nullable=True),
        sa.Column('heure_reveil', sa.String(), nullable=True),
        sa.Column('bpm_repos', sa.Integer(), nullable=True),
        sa.Column('bpm_moy', sa.Integer(), nullable=True),
        sa.Column('bpm_min', sa.Integer(), nullable=True),
        sa.Column('bpm_max', sa.Integer(), nullable=True),
        sa.Column('stress_moy', sa.Integer(), nullable=True),
        sa.Column('stress_max', sa.Integer(), nullable=True),
        sa.Column('body_battery_max', sa.Integer(), nullable=True),
        sa.Column('body_battery_min', sa.Integer(), nullable=True),
        sa.Column('steps', sa.Integer(), nullable=True),
        sa.Column('steps_goal', sa.Integer(), nullable=True),
        sa.Column('etages', sa.Integer(), nullable=True),
        sa.Column('respiration_moy', sa.Float(), nullable=True),
        sa.Column('spo2_moy', sa.Integer(), nullable=True),
        sa.Column('hrv_moy', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'date', name='uq_daily_stats_user_date'),
    )


def downgrade() -> None:
    op.drop_table('daily_stats')
