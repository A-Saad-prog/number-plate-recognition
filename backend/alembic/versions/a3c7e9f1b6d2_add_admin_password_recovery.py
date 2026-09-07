"""add admin password recovery

Revision ID: a3c7e9f1b6d2
Revises: f4b8d2a6c913
Create Date: 2026-09-08 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a3c7e9f1b6d2"
down_revision: Union[str, Sequence[str], None] = "f4b8d2a6c913"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Existing admins keep their current email/password untouched; the new
    # columns get safe defaults via server_default so no backfill is needed
    # and no admin account is affected. A manually-entered email stays
    # email_verified=false until the real verification flow succeeds.
    op.add_column(
        "admin_users",
        sa.Column("email_verified", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "admin_users",
        sa.Column("totp_secret_encrypted", sa.Text(), nullable=True),
    )
    op.add_column(
        "admin_users",
        sa.Column("totp_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "admin_users",
        sa.Column("session_version", sa.Integer(), nullable=False, server_default="1"),
    )

    op.create_table(
        "admin_password_recovery",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("admin_user_id", sa.Integer(), nullable=False),
        sa.Column("purpose", sa.String(length=30), nullable=False),
        sa.Column("challenge_token", sa.String(length=64), nullable=False),
        sa.Column("otp_digest", sa.String(length=64), nullable=True),
        sa.Column("reset_token_digest", sa.String(length=64), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("verified_at", sa.DateTime(), nullable=True),
        sa.Column("used_at", sa.DateTime(), nullable=True),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["admin_user_id"], ["admin_users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_admin_password_recovery_id"), "admin_password_recovery", ["id"], unique=False
    )
    op.create_index(
        op.f("ix_admin_password_recovery_admin_user_id"),
        "admin_password_recovery",
        ["admin_user_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_admin_password_recovery_challenge_token"),
        "admin_password_recovery",
        ["challenge_token"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        op.f("ix_admin_password_recovery_challenge_token"), table_name="admin_password_recovery"
    )
    op.drop_index(
        op.f("ix_admin_password_recovery_admin_user_id"), table_name="admin_password_recovery"
    )
    op.drop_index(op.f("ix_admin_password_recovery_id"), table_name="admin_password_recovery")
    op.drop_table("admin_password_recovery")

    op.drop_column("admin_users", "session_version")
    op.drop_column("admin_users", "totp_enabled")
    op.drop_column("admin_users", "totp_secret_encrypted")
    op.drop_column("admin_users", "email_verified")
