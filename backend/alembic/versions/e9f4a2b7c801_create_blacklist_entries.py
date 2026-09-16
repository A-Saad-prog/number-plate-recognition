"""create blacklist entries

Revision ID: e9f4a2b7c801
Revises: d8a1c5f930e4
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "e9f4a2b7c801"
down_revision: Union[str, Sequence[str], None] = "d8a1c5f930e4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "blacklist_entries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("license_plate", sa.String(length=20), nullable=False),
        sa.Column("vehicle_name", sa.String(length=100), nullable=True),
        sa.Column("description", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("tenant_id", "license_plate", name="uq_blacklist_tenant_plate"),
    )
    op.create_index(op.f("ix_blacklist_entries_id"), "blacklist_entries", ["id"], unique=False)
    op.create_index(op.f("ix_blacklist_entries_tenant_id"), "blacklist_entries", ["tenant_id"], unique=False)
    op.create_index(op.f("ix_blacklist_entries_license_plate"), "blacklist_entries", ["license_plate"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_blacklist_entries_license_plate"), table_name="blacklist_entries")
    op.drop_index(op.f("ix_blacklist_entries_tenant_id"), table_name="blacklist_entries")
    op.drop_index(op.f("ix_blacklist_entries_id"), table_name="blacklist_entries")
    op.drop_table("blacklist_entries")
