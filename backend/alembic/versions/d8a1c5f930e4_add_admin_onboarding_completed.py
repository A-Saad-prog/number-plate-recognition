"""add admin onboarding completed flag

Revision ID: d8a1c5f930e4
Revises: a3c7e9f1b6d2
Create Date: 2026-09-08 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d8a1c5f930e4"
down_revision: Union[str, Sequence[str], None] = "a3c7e9f1b6d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "admin_users",
        sa.Column("onboarding_completed", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.alter_column("admin_users", "onboarding_completed", server_default=None)


def downgrade() -> None:
    op.drop_column("admin_users", "onboarding_completed")
