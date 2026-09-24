"""add Garmin raw JSON (activities, daily_stats) and daily_stats.synced_at

Revision ID: d3e4f5a6b7c8
Revises: c2d3e4f5a6b7
Create Date: 2026-09-24 12:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'd3e4f5a6b7c8'
down_revision: Union[str, None] = 'c2d3e4f5a6b7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('activities', sa.Column('raw_data', sa.Text(), nullable=True))
    op.add_column('daily_stats', sa.Column('raw_data', sa.Text(), nullable=True))
    op.add_column('daily_stats', sa.Column('synced_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('daily_stats', 'synced_at')
    op.drop_column('daily_stats', 'raw_data')
    op.drop_column('activities', 'raw_data')
