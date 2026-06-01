"""initial

Revision ID: da0d68c72424
Revises: 
Create Date: 2026-05-18 21:15:25.970780

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'da0d68c72424'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'ingredients',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('nom', sa.String(), nullable=False, unique=True),
        sa.Column('calories', sa.Float(), nullable=True),
        sa.Column('proteines', sa.Float(), nullable=True),
        sa.Column('glucides', sa.Float(), nullable=True),
        sa.Column('lipides', sa.Float(), nullable=True),
        sa.Column('unite', sa.String(), nullable=True),
        sa.Column('quantite_defaut', sa.Float(), nullable=True),
    )
    op.create_table(
        'recipes',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('nom', sa.String(), nullable=False, unique=True),
        sa.Column('description', sa.String(), nullable=True),
    )
    op.create_table(
        'recipe_ingredients',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('recipe_id', sa.Integer(), sa.ForeignKey('recipes.id'), nullable=False),
        sa.Column('ingredient_id', sa.Integer(), sa.ForeignKey('ingredients.id'), nullable=False),
        sa.Column('quantite', sa.Float(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table('recipe_ingredients')
    op.drop_table('recipes')
    op.drop_table('ingredients')
