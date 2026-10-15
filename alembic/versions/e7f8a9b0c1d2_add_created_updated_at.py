"""dates de création (created_at) partout, et de dernière modification (updated_at) sur les lignes qu'on modifie

Les lignes existantes gardent une date vide (inconnue) : seules les nouvelles sont datées.

Revision ID: e7f8a9b0c1d2
Revises: d6e7f8a9b0c1
Create Date: 2026-10-15 10:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "e7f8a9b0c1d2"
down_revision: Union[str, None] = "d6e7f8a9b0c1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CREATED = ['ingredients', 'nutriments', 'ingredient_nutriments', 'recipes', 'recipe_ingredients', 'activity_types', 'users', 'meal_logs', 'activities', 'daily_stats', 'fitness_metrics']
UPDATED = ['ingredients', 'recipes', 'fridge_items', 'tasks', 'body_compositions']


def upgrade() -> None:
    # Sans valeur par défaut en base : les lignes déjà là restent sans date (l'appli date les nouvelles)
    for table in CREATED:
        op.add_column(table, sa.Column("created_at", sa.DateTime(), nullable=True))
    for table in UPDATED:
        op.add_column(table, sa.Column("updated_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    for table in UPDATED:
        op.drop_column(table, "updated_at")
    for table in CREATED:
        op.drop_column(table, "created_at")
