"""drop unused admin activity audit table

Revision ID: c3e5f7a9b102
Revises: b9c2d4e6f801
"""
from alembic import op

revision = "c3e5f7a9b102"
down_revision = "b9c2d4e6f801"
branch_labels = None
depends_on = None


def upgrade():
    op.drop_index("ix_admin_activity_admin_id", table_name="admin_activity")
    op.drop_index("ix_admin_activity_tenant_id", table_name="admin_activity")
    op.drop_table("admin_activity")


def downgrade():
    # The retired audit data cannot be reconstructed on downgrade.
    raise RuntimeError("Admin activity audit removal is irreversible.")
