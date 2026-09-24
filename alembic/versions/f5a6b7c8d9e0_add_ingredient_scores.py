"""add ingredients.nutriscore, nova, regime

Revision ID: f5a6b7c8d9e0
Revises: e4f5a6b7c8d9
Create Date: 2026-09-24 20:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'f5a6b7c8d9e0'
down_revision: Union[str, None] = 'e4f5a6b7c8d9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('ingredients', sa.Column('nutriscore', sa.String(length=1), nullable=True))
    op.add_column('ingredients', sa.Column('nova', sa.Integer(), nullable=True))
    op.add_column('ingredients', sa.Column('regime', sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column('ingredients', 'regime')
    op.drop_column('ingredients', 'nova')
    op.drop_column('ingredients', 'nutriscore')
