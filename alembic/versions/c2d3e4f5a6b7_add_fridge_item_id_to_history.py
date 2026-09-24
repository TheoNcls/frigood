"""add fridge_history.fridge_item_id

Revision ID: c2d3e4f5a6b7
Revises: b1c2d3e4f5a6
Create Date: 2026-09-23 18:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'c2d3e4f5a6b7'
down_revision: Union[str, None] = 'b1c2d3e4f5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('fridge_history', sa.Column('fridge_item_id', sa.Integer(), nullable=True))
    op.create_index('ix_fridge_history_fridge_item_id', 'fridge_history', ['fridge_item_id'])


def downgrade() -> None:
    op.drop_index('ix_fridge_history_fridge_item_id', table_name='fridge_history')
    op.drop_column('fridge_history', 'fridge_item_id')
