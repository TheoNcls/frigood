"""add activity_types.garmin_type_key

Revision ID: e4f5a6b7c8d9
Revises: d3e4f5a6b7c8
Create Date: 2026-09-24 16:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'e4f5a6b7c8d9'
down_revision: Union[str, None] = 'd3e4f5a6b7c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('activity_types', sa.Column('garmin_type_key', sa.String(length=80), nullable=True))
    op.create_index('ix_activity_types_garmin_type_key', 'activity_types', ['garmin_type_key'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_activity_types_garmin_type_key', table_name='activity_types')
    op.drop_column('activity_types', 'garmin_type_key')
