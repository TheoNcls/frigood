"""tâches sportives : type d'activité qui valide la tâche

Revision ID: 2b3c4d5e6f7a
Revises: 1a2b3c4d5e6f
Create Date: 2026-10-03 10:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "2b3c4d5e6f7a"
down_revision: Union[str, None] = "1a2b3c4d5e6f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Simple ajout de colonne, sans reconstruire la table ; la clé étrangère sur Postgres (SQLite ne sait pas l'ajouter après coup)
    op.add_column("tasks", sa.Column("activity_type_id", sa.Integer(), nullable=True))
    if op.get_bind().dialect.name != "sqlite":
        op.create_foreign_key("fk_tasks_activity_type", "tasks", "activity_types", ["activity_type_id"], ["id"], ondelete="SET NULL")


def downgrade() -> None:
    if op.get_bind().dialect.name != "sqlite":
        op.drop_constraint("fk_tasks_activity_type", "tasks", type_="foreignkey")
    op.drop_column("tasks", "activity_type_id")
