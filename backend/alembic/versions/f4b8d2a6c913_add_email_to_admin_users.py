"""add email to admin_users

Revision ID: f4b8d2a6c913
Revises: 290bef60e7d1
Create Date: 2026-09-07 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f4b8d2a6c913"
down_revision: Union[str, Sequence[str], None] = "290bef60e7d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("admin_users", sa.Column("email", sa.String(length=255), nullable=True))
    op.create_index(op.f("ix_admin_users_email"), "admin_users", ["email"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_admin_users_email"), table_name="admin_users")
    op.drop_column("admin_users", "email")
