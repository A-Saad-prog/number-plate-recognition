"""add payment_method to parking sessions

Revision ID: b3c8e1f4a901
Revises: a77f582da792
Create Date: 2026-08-23 05:10:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b3c8e1f4a901"
down_revision: Union[str, Sequence[str], None] = "a77f582da792"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "parking_sessions",
        sa.Column("payment_method", sa.String(length=10), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("parking_sessions", "payment_method")
