"""create admin users

Revision ID: c4f1a9d8e2b3
Revises: b3c8e1f4a901
Create Date: 2026-08-25 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c4f1a9d8e2b3"
down_revision: Union[str, Sequence[str], None] = "b3c8e1f4a901"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "admin_users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(length=80), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_admin_users_id"), "admin_users", ["id"], unique=False)
    op.create_index(op.f("ix_admin_users_username"), "admin_users", ["username"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_admin_users_username"), table_name="admin_users")
    op.drop_index(op.f("ix_admin_users_id"), table_name="admin_users")
    op.drop_table("admin_users")
