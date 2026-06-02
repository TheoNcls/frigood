"""add categorie to ingredients and recipes, portions and temps_preparation to recipes

Revision ID: c8d4e3f2a1b0
Revises: b7c3d2e1f0a9
Create Date: 2026-06-02 09:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c8d4e3f2a1b0'
down_revision: Union[str, Sequence[str], None] = 'b7c3d2e1f0a9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('ingredients', sa.Column('categorie', sa.String(), nullable=True))
    op.add_column('recipes', sa.Column('categorie', sa.String(), nullable=True))
    op.add_column('recipes', sa.Column('portions', sa.Integer(), nullable=True, server_default='1'))
    op.add_column('recipes', sa.Column('temps_preparation', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('recipes', 'temps_preparation')
    op.drop_column('recipes', 'portions')
    op.drop_column('recipes', 'categorie')
    op.drop_column('ingredients', 'categorie')
