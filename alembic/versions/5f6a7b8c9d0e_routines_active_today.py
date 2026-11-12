"""habitudes journalières : activées pour la journée d'un clic (plus de jours prédéfinis)

Revision ID: 5f6a7b8c9d0e
Revises: 6e7f8a9b0c1d
Create Date: 2026-11-12 20:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "5f6a7b8c9d0e"
down_revision: Union[str, None] = "6e7f8a9b0c1d"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("daily_routines") as batch:
        batch.add_column(sa.Column("active_le", sa.Date(), nullable=True))
        batch.drop_column("jours")
        batch.drop_column("active")


def downgrade() -> None:
    with op.batch_alter_table("daily_routines") as batch:
        batch.add_column(sa.Column("jours", sa.String(7), nullable=False, server_default="01234"))
        batch.add_column(sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()))
        batch.drop_column("active_le")
