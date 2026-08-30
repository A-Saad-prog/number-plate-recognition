"""merge migration heads

Revision ID: c22d5d36c64d
Revises: d7e2f1a9b4c6, e6f2a1b8c930
Create Date: 2026-08-31 04:48:45.997519

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c22d5d36c64d'
down_revision: Union[str, Sequence[str], None] = ('d7e2f1a9b4c6', 'e6f2a1b8c930')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
