"""ingrédients : composition (liste des ingrédients des produits transformés)

Revision ID: f1a2b3c4d5e6
Revises: e0f1a2b3c4d5
Create Date: 2026-09-29 10:00:00.000000

"""
import json
import re
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, None] = "e0f1a2b3c4d5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _composition(product: dict) -> str | None:
    # Copie figée de app.openfoodfacts.composition : une migration ne doit pas dépendre du code qui évolue
    text = product.get("ingredients_text_fr") or product.get("ingredients_text") or ""
    text = re.sub(r"_([^_]+)_", r"\1", text).replace("_", "")
    text = re.sub(r"\s+", " ", text).strip().rstrip(".")
    return text[:5000] or None


def upgrade() -> None:
    op.add_column("ingredients", sa.Column("composition", sa.Text(), nullable=True))

    # Produits déjà scannés : composition tirée du JSON OpenFoodFacts stocké (le plus récent par ingrédient)
    conn = op.get_bind()
    rows = conn.execute(sa.text(
        "SELECT ingredient_id, raw_data FROM ingredient_sources "
        "WHERE source_type = 'openfoodfacts' AND raw_data IS NOT NULL ORDER BY id DESC"
    )).fetchall()
    done = set()
    for ingredient_id, raw in rows:
        if ingredient_id in done:
            continue
        done.add(ingredient_id)
        try:
            text = _composition(json.loads(raw).get("product") or {})
        except (ValueError, AttributeError, TypeError):
            continue
        if text:
            conn.execute(
                sa.text("UPDATE ingredients SET composition = :c WHERE id = :id AND composition IS NULL"),
                {"c": text, "id": ingredient_id},
            )


def downgrade() -> None:
    op.drop_column("ingredients", "composition")
