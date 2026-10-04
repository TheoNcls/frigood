"""plats préparés : ingrédients réellement utilisés et portions, repris par les repas

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-10-04 10:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "d4e5f6a7b8c9"
down_revision: Union[str, None] = "c3d4e5f6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "preparations",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("recipe_id", sa.Integer(), sa.ForeignKey("recipes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("portions", sa.Float(), nullable=False),
        sa.Column("date", sa.Date(), nullable=True),
        sa.Column("adaptee", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_preparations_user_id", "preparations", ["user_id"])
    op.create_table(
        "preparation_ingredients",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("preparation_id", sa.Integer(), sa.ForeignKey("preparations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ingredient_id", sa.Integer(), sa.ForeignKey("ingredients.id", ondelete="CASCADE"), nullable=False),
        sa.Column("quantite", sa.Float(), nullable=False),
    )
    op.create_index("ix_preparation_ingredients_preparation_id", "preparation_ingredients", ["preparation_id"])

    # Plats déjà au frigo et anciens repas : sans préparation, ils gardent la recette d'origine
    op.add_column("fridge_items", sa.Column("preparation_id", sa.Integer(), nullable=True))
    op.add_column("meal_logs", sa.Column("preparation_id", sa.Integer(), nullable=True))
    if op.get_bind().dialect.name != "sqlite":
        op.create_foreign_key("fk_fridge_items_preparation", "fridge_items", "preparations",
                              ["preparation_id"], ["id"], ondelete="SET NULL")
        op.create_foreign_key("fk_meal_logs_preparation", "meal_logs", "preparations",
                              ["preparation_id"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    if op.get_bind().dialect.name != "sqlite":
        op.drop_constraint("fk_meal_logs_preparation", "meal_logs", type_="foreignkey")
        op.drop_constraint("fk_fridge_items_preparation", "fridge_items", type_="foreignkey")
    op.drop_column("meal_logs", "preparation_id")
    op.drop_column("fridge_items", "preparation_id")
    op.drop_index("ix_preparation_ingredients_preparation_id", "preparation_ingredients")
    op.drop_table("preparation_ingredients")
    op.drop_index("ix_preparations_user_id", "preparations")
    op.drop_table("preparations")
