"""allow tracking sessions without a parking space

Revision ID: a2b4c6d8e901
Revises: c22d5d36c64d
"""
from alembic import op
import sqlalchemy as sa

revision = "a2b4c6d8e901"
down_revision = "c22d5d36c64d"
branch_labels = None
depends_on = None


def upgrade():
    op.alter_column("parking_sessions", "parking_space_id", existing_type=sa.Integer(), nullable=True)


def downgrade():
    # A downgrade is unsafe while tracking-only sessions exist.
    raise RuntimeError("Delete or assign tracking-only sessions before downgrading.")
