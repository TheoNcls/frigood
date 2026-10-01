"""recettes : qui l'a créée (created_by, 0 = inconnu)

Revision ID: 1a2b3c4d5e6f
Revises: c4d5e6f7a8b9
Create Date: 2026-10-02 14:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "1a2b3c4d5e6f"
down_revision: Union[str, None] = "c4d5e6f7a8b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Recettes existantes : 0 (créateur inconnu)
    op.add_column("recipes", sa.Column("created_by", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("recipes", "created_by")
