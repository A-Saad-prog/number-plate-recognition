"""create daily parking analytics

Revision ID: b9c2d4e6f801
Revises: a81df75abc7f
"""
from alembic import op
import sqlalchemy as sa

revision = "b9c2d4e6f801"
down_revision = "a81df75abc7f"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "daily_parking_analytics",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("analytics_date", sa.Date(), nullable=False),
        sa.Column("total_earnings", sa.Float(), nullable=False, server_default="0"),
        sa.Column("total_entries", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("completed_sessions", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("average_duration_seconds", sa.Float(), nullable=False, server_default="0"),
        sa.Column("rush_hour_start", sa.Integer(), nullable=True),
        sa.Column("peak_hour_vehicle_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("tenant_id", "analytics_date", name="uq_daily_analytics_tenant_date"),
    )
    op.create_index("ix_daily_analytics_tenant_date", "daily_parking_analytics", ["tenant_id", "analytics_date"])


def downgrade():
    op.drop_index("ix_daily_analytics_tenant_date", table_name="daily_parking_analytics")
    op.drop_table("daily_parking_analytics")
