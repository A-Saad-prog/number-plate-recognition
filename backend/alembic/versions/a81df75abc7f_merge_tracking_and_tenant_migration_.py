"""merge tracking and tenant migration heads

Revision ID: a81df75abc7f
Revises: a2b4c6d8e901, f1a2b3c4d5e6
Create Date: 2026-09-04 04:07:13.590862

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a81df75abc7f'
down_revision: Union[str, Sequence[str], None] = ('a2b4c6d8e901', 'f1a2b3c4d5e6')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
