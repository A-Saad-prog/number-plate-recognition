"""remove legacy qr and plate image schema

Revision ID: f8020033ddd0
Revises:
Create Date: 2026-08-18 21:51:06.778839
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "f8020033ddd0"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index(
        op.f("ix_qr_codes_code"),
        table_name="qr_codes",
    )

    op.drop_index(
        op.f("ix_qr_codes_id"),
        table_name="qr_codes",
    )

    op.drop_table("qr_codes")

    op.drop_column(
        "parking_sessions",
        "exit_plate_image",
    )

    op.drop_column(
        "parking_sessions",
        "entry_plate_image",
    )


def downgrade() -> None:
    op.add_column(
        "parking_sessions",
        sa.Column(
            "entry_plate_image",
            postgresql.BYTEA(),
            autoincrement=False,
            nullable=True,
        ),
    )

    op.add_column(
        "parking_sessions",
        sa.Column(
            "exit_plate_image",
            postgresql.BYTEA(),
            autoincrement=False,
            nullable=True,
        ),
    )

    op.create_table(
        "qr_codes",
        sa.Column(
            "id",
            sa.INTEGER(),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column(
            "session_id",
            sa.INTEGER(),
            autoincrement=False,
            nullable=False,
        ),
        sa.Column(
            "code",
            sa.VARCHAR(length=100),
            autoincrement=False,
            nullable=False,
        ),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(),
            autoincrement=False,
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["parking_sessions.id"],
            name=op.f("qr_codes_session_id_fkey"),
        ),
        sa.PrimaryKeyConstraint(
            "id",
            name=op.f("qr_codes_pkey"),
        ),
        sa.UniqueConstraint(
            "session_id",
            name=op.f("qr_codes_session_id_key"),
            postgresql_include=[],
            postgresql_nulls_not_distinct=False,
        ),
    )

    op.create_index(
        op.f("ix_qr_codes_id"),
        "qr_codes",
        ["id"],
        unique=False,
    )

    op.create_index(
        op.f("ix_qr_codes_code"),
        "qr_codes",
        ["code"],
        unique=True,
    )