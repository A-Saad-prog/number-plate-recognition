"""add admin settings

Revision ID: e6f2a1b8c930
Revises: c4f1a9d8e2b3
Create Date: 2026-08-31 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e6f2a1b8c930"
down_revision: Union[str, Sequence[str], None] = "c4f1a9d8e2b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "admin_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("garage_settings", sa.JSON(), nullable=False),
        sa.Column("camera_config", sa.JSON(), nullable=False),
        sa.Column("billing_config", sa.JSON(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("admin_settings")
