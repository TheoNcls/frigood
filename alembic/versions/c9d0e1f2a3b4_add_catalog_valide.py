"""catalogue partagé : ingrédients et recettes validés (visibles par tous) ou propres à leur créateur

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-10-07 18:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "c9d0e1f2a3b4"
down_revision: Union[str, None] = "b8c9d0e1f2a3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = ("ingredients", "recipes")


def _drop_unique_nom(table: str):
    """Deux comptes peuvent avoir chacun leur « Nutella » : l'unicité du nom passe dans l'appli."""
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        return
    inspector = sa.inspect(bind)
    for uc in inspector.get_unique_constraints(table):
        if uc["column_names"] == ["nom"] and uc.get("name"):
            op.drop_constraint(uc["name"], table, type_="unique")
    for ix in inspector.get_indexes(table):
        if ix.get("unique") and ix["column_names"] == ["nom"] and ix.get("name"):
            op.drop_index(ix["name"], table_name=table)


def upgrade() -> None:
    for table in TABLES:
        # Tout le catalogue actuel est validé (visible par tout le monde, comme avant)
        op.add_column(table, sa.Column("valide", sa.Boolean(), nullable=False, server_default=sa.true()))
        _drop_unique_nom(table)


def downgrade() -> None:
    for table in TABLES:
        op.drop_column(table, "valide")
        if op.get_bind().dialect.name != "sqlite":
            # Échoue s'il existe des doublons de nom : à fusionner avant de revenir en arrière
            op.create_unique_constraint(f"{table}_nom_key", table, ["nom"])
