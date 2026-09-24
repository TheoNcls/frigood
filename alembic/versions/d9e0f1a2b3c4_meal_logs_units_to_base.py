"""meal_logs saisis à l'unité : conversion en g / ml

Revision ID: d9e0f1a2b3c4
Revises: c8d9e0f1a2b3
Create Date: 2026-09-26 10:00:00.000000

"""
from typing import Sequence, Union
from alembic import op

revision: str = "d9e0f1a2b3c4"
down_revision: Union[str, None] = "c8d9e0f1a2b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Les repas « × N unité(s) » deviennent N × volume d'une unité (en g ou ml) ; sans volume connu, on n'y touche pas
    op.execute("""
        UPDATE meal_logs
        SET quantite = ROUND(CAST(quantite * (
                SELECT i.quantite_defaut FROM ingredients i WHERE i.id = meal_logs.ingredient_id
            ) AS NUMERIC), 2),
            type_mesure = 'poids'
        WHERE type_mesure = 'unite'
          AND ingredient_id IS NOT NULL
          AND quantite IS NOT NULL
          AND (SELECT i.quantite_defaut FROM ingredients i WHERE i.id = meal_logs.ingredient_id) > 0
    """)


def downgrade() -> None:
    # Conversion sans retour : la quantité en g / ml reste juste
    pass
