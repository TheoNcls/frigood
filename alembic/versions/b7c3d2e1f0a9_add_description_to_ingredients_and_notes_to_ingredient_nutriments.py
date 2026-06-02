"""add description to ingredients and notes to ingredient_nutriments

Revision ID: b7c3d2e1f0a9
Revises: a3f2b1c4d5e6
Create Date: 2026-06-02 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b7c3d2e1f0a9'
down_revision: Union[str, Sequence[str], None] = 'a3f2b1c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('ingredients', sa.Column('description', sa.String(), nullable=True))
    op.add_column('ingredient_nutriments', sa.Column('notes', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('ingredient_nutriments', 'notes')
    op.drop_column('ingredients', 'description')
