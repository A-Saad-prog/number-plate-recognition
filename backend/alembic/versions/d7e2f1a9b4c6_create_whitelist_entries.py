"""create whitelist entries

Revision ID: d7e2f1a9b4c6
Revises: c4f1a9d8e2b3
Create Date: 2026-08-25 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d7e2f1a9b4c6"
down_revision: Union[str, Sequence[str], None] = "c4f1a9d8e2b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "whitelist_entries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("license_plate", sa.String(length=20), nullable=False),
        sa.Column("vehicle_name", sa.String(length=100), nullable=False),
        sa.Column("discount_percent", sa.Float(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_whitelist_entries_id"), "whitelist_entries", ["id"], unique=False)
    op.create_index(op.f("ix_whitelist_entries_license_plate"), "whitelist_entries", ["license_plate"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_whitelist_entries_license_plate"), table_name="whitelist_entries")
    op.drop_index(op.f("ix_whitelist_entries_id"), table_name="whitelist_entries")
    op.drop_table("whitelist_entries")