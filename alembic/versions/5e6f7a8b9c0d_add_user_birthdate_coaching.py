"""utilisateurs : date de naissance et texte « infos & objectifs » (futur coaching)

Revision ID: 5e6f7a8b9c0d
Revises: 4d5e6f7a8b9c
Create Date: 2026-10-04 15:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "5e6f7a8b9c0d"
down_revision: Union[str, None] = "4d5e6f7a8b9c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("date_naissance", sa.Date(), nullable=True))
    op.add_column("users", sa.Column("profil_coaching", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "profil_coaching")
    op.drop_column("users", "date_naissance")
