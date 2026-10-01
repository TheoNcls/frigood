"""ingrédients : qui l'a créé (created_by, 0 = inconnu)

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
Create Date: 2026-10-02 10:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "c4d5e6f7a8b9"
down_revision: Union[str, None] = "b3c4d5e6f7a8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Ingrédients existants : 0 (créateur inconnu)
    op.add_column("ingredients", sa.Column("created_by", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("ingredients", "created_by")
