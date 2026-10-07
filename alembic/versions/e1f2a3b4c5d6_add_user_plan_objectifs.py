"""plan à long terme vers les objectifs (généré une fois par le coach, puis modifiable)

Revision ID: e1f2a3b4c5d6
Revises: d0e1f2a3b4c5
Create Date: 2026-10-08 14:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "e1f2a3b4c5d6"
down_revision: Union[str, None] = "d0e1f2a3b4c5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("plan_objectifs", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("plan_genere_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "plan_genere_at")
    op.drop_column("users", "plan_objectifs")
