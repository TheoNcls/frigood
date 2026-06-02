"""add activity_types and activities

Revision ID: d5e6f7a8b9c0
Revises: c8d4e3f2a1b0
Create Date: 2026-06-02 10:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'd5e6f7a8b9c0'
down_revision: Union[str, Sequence[str], None] = 'c8d4e3f2a1b0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'activity_types',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('nom', sa.String(), nullable=False),
        sa.Column('description', sa.String(), nullable=True),
        sa.Column('met_value', sa.Float(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('nom'),
    )
    op.create_table(
        'activities',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('activity_type_id', sa.Integer(), nullable=True),
        sa.Column('source', sa.String(), nullable=False),
        sa.Column('garmin_activity_id', sa.String(), nullable=True),
        sa.Column('duree_min', sa.Integer(), nullable=True),
        sa.Column('calories', sa.Float(), nullable=True),
        sa.Column('distance_km', sa.Float(), nullable=True),
        sa.Column('freq_cardiaque_moy', sa.Integer(), nullable=True),
        sa.Column('notes', sa.String(), nullable=True),
        sa.ForeignKeyConstraint(['activity_type_id'], ['activity_types.id']),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('garmin_activity_id'),
    )


def downgrade() -> None:
    op.drop_table('activities')
    op.drop_table('activity_types')
