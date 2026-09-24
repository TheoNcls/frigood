"""add tasks and task_completions

Revision ID: c8d9e0f1a2b3
Revises: b7c8d9e0f1a2
Create Date: 2026-09-25 14:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'c8d9e0f1a2b3'
down_revision: Union[str, None] = 'b7c8d9e0f1a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'tasks',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('titre', sa.String(length=200), nullable=False),
        sa.Column('notes', sa.String(), nullable=True),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('heure', sa.String(length=5), nullable=True),
        sa.Column('recurrence', sa.String(length=10), nullable=True),
        sa.Column('recurrence_fin', sa.Date(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_tasks_user_id', 'tasks', ['user_id'])

    op.create_table(
        'task_completions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('task_id', sa.Integer(), nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('done_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('task_id', 'date', name='uq_task_completion_day'),
    )
    op.create_index('ix_task_completions_task_id', 'task_completions', ['task_id'])


def downgrade() -> None:
    op.drop_index('ix_task_completions_task_id', table_name='task_completions')
    op.drop_table('task_completions')
    op.drop_index('ix_tasks_user_id', table_name='tasks')
    op.drop_table('tasks')
