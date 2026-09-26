"""create admin MFA recovery codes

Revision ID: f6a7b8c9d012
Revises: e9f4a2b7c801
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "f6a7b8c9d012"
down_revision: Union[str, Sequence[str], None] = "e9f4a2b7c801"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "admin_mfa_recovery_codes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("admin_user_id", sa.Integer(), nullable=False),
        sa.Column("code_hash", sa.String(length=64), nullable=False),
        sa.Column("used_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["admin_user_id"], ["admin_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_admin_mfa_recovery_codes_id"), "admin_mfa_recovery_codes", ["id"], unique=False)
    op.create_index(op.f("ix_admin_mfa_recovery_codes_admin_user_id"), "admin_mfa_recovery_codes", ["admin_user_id"], unique=False)
    op.create_index(op.f("ix_admin_mfa_recovery_codes_code_hash"), "admin_mfa_recovery_codes", ["code_hash"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_admin_mfa_recovery_codes_code_hash"), table_name="admin_mfa_recovery_codes")
    op.drop_index(op.f("ix_admin_mfa_recovery_codes_admin_user_id"), table_name="admin_mfa_recovery_codes")
    op.drop_index(op.f("ix_admin_mfa_recovery_codes_id"), table_name="admin_mfa_recovery_codes")
    op.drop_table("admin_mfa_recovery_codes")
