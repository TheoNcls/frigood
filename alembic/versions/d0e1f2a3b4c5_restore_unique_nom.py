"""nom unique à nouveau pour les ingrédients et les recettes : un nom pris se réutilise au lieu d'être recréé

La migration précédente avait retiré la contrainte ; on la remet. Si des doublons exacts ont été créés
entre-temps, les plus récents sont renommés « Nom (id) » avant de recréer la contrainte.

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-10-08 10:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "d0e1f2a3b4c5"
down_revision: Union[str, None] = "c9d0e1f2a3b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLES = ("ingredients", "recipes")


def _has_unique_nom(inspector, table: str) -> bool:
    if any(uc["column_names"] == ["nom"] for uc in inspector.get_unique_constraints(table)):
        return True
    return any(ix.get("unique") and ix["column_names"] == ["nom"] for ix in inspector.get_indexes(table))


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        return  # bases de test : créées depuis les modèles, où le nom est déjà unique
    inspector = sa.inspect(bind)
    for table in TABLES:
        if _has_unique_nom(inspector, table):
            continue
        t = sa.table(table, sa.column("id", sa.Integer()), sa.column("nom", sa.String()))
        rows = bind.execute(sa.select(t.c.id, t.c.nom).order_by(t.c.id)).all()
        seen = set()
        for row_id, nom in rows:
            if nom in seen:
                op.execute(t.update().where(t.c.id == row_id).values(nom=f"{nom} ({row_id})"))
            seen.add(nom)
        op.create_unique_constraint(f"{table}_nom_key", table, ["nom"])


def downgrade() -> None:
    if op.get_bind().dialect.name == "sqlite":
        return
    for table in TABLES:
        op.drop_constraint(f"{table}_nom_key", table, type_="unique")
