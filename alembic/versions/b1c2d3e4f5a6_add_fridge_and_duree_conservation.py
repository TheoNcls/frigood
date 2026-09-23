"""add fridge_items, fridge_history and ingredients.duree_conservation

Revision ID: b1c2d3e4f5a6
Revises: a0b1c2d3e4f5
Create Date: 2026-09-23 12:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'b1c2d3e4f5a6'
down_revision: Union[str, None] = 'a0b1c2d3e4f5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # server_default remplit aussi les ingrédients existants avec 7 jours
    op.add_column('ingredients', sa.Column('duree_conservation', sa.Integer(), nullable=True, server_default='7'))

    op.create_table(
        'fridge_items',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('ingredient_id', sa.Integer(), nullable=True),
        sa.Column('recipe_id', sa.Integer(), nullable=True),
        sa.Column('quantite', sa.Float(), nullable=False),
        sa.Column('date_achat', sa.Date(), nullable=True),
        sa.Column('date_peremption', sa.Date(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['ingredient_id'], ['ingredients.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['recipe_id'], ['recipes.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_fridge_items_user_id', 'fridge_items', ['user_id'])

    op.create_table(
        'fridge_history',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('ingredient_id', sa.Integer(), nullable=True),
        sa.Column('recipe_id', sa.Integer(), nullable=True),
        sa.Column('quantite', sa.Float(), nullable=False),
        sa.Column('action', sa.String(length=30), nullable=False),
        sa.Column('meal_log_id', sa.Integer(), nullable=True),
        sa.Column('date_achat', sa.Date(), nullable=True),
        sa.Column('date_peremption', sa.Date(), nullable=True),
        sa.Column('notes', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['ingredient_id'], ['ingredients.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['recipe_id'], ['recipes.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['meal_log_id'], ['meal_logs.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_fridge_history_user_id', 'fridge_history', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_fridge_history_user_id', table_name='fridge_history')
    op.drop_table('fridge_history')
    op.drop_index('ix_fridge_items_user_id', table_name='fridge_items')
    op.drop_table('fridge_items')
    op.drop_column('ingredients', 'duree_conservation')
