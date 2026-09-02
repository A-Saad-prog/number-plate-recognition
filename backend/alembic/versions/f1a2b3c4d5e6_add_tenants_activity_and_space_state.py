"""add tenant scoping, activity log, and active parking spaces

Revision ID: f1a2b3c4d5e6
Revises: c22d5d36c64d
"""
from alembic import op
import sqlalchemy as sa


revision = "f1a2b3c4d5e6"
down_revision = "c22d5d36c64d"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # This SaaS transition intentionally starts application data clean. It does
    # not touch Supabase auth, storage, or any non-application tables.
    for table in ("parking_sessions", "whitelist_entries", "parking_spaces", "vehicles", "admin_settings", "admin_users"):
        op.execute(f"DELETE FROM {table}")

    op.create_table(
        "tenants",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_tenants_name"),
    )
    for table in ("admin_users", "admin_settings", "parking_spaces", "parking_sessions", "vehicles", "whitelist_entries"):
        op.add_column(table, sa.Column("tenant_id", sa.Integer(), nullable=False))
        op.create_foreign_key(f"fk_{table}_tenant", table, "tenants", ["tenant_id"], ["id"])
        op.create_index(f"ix_{table}_tenant_id", table, ["tenant_id"])

    op.add_column("parking_spaces", sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("parking_sessions", sa.Column("discount_percent", sa.Float(), nullable=True))
    op.create_index("ix_parking_spaces_is_active", "parking_spaces", ["is_active"])
    op.create_unique_constraint("uq_parking_space_tenant_level_number", "parking_spaces", ["tenant_id", "level", "space_number"])

    op.drop_index("ix_vehicles_license_plate", table_name="vehicles")
    op.create_unique_constraint("uq_vehicle_tenant_plate", "vehicles", ["tenant_id", "license_plate"])
    op.drop_index("ix_whitelist_entries_license_plate", table_name="whitelist_entries")
    op.create_unique_constraint("uq_whitelist_tenant_plate", "whitelist_entries", ["tenant_id", "license_plate"])
    op.create_unique_constraint("uq_admin_settings_tenant", "admin_settings", ["tenant_id"])

    op.create_table(
        "admin_activity",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("tenant_id", sa.Integer(), nullable=False),
        sa.Column("admin_id", sa.Integer(), nullable=False),
        sa.Column("action", sa.String(length=100), nullable=False),
        sa.Column("old_value", sa.JSON(), nullable=True),
        sa.Column("new_value", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["admin_id"], ["admin_users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_admin_activity_tenant_id", "admin_activity", ["tenant_id"])
    op.create_index("ix_admin_activity_admin_id", "admin_activity", ["admin_id"])


def downgrade() -> None:
    op.drop_index("ix_admin_activity_admin_id", table_name="admin_activity")
    op.drop_index("ix_admin_activity_tenant_id", table_name="admin_activity")
    op.drop_table("admin_activity")
    op.drop_constraint("uq_admin_settings_tenant", "admin_settings", type_="unique")
    op.drop_constraint("uq_whitelist_tenant_plate", "whitelist_entries", type_="unique")
    op.create_index("ix_whitelist_entries_license_plate", "whitelist_entries", ["license_plate"], unique=True)
    op.drop_constraint("uq_vehicle_tenant_plate", "vehicles", type_="unique")
    op.create_index("ix_vehicles_license_plate", "vehicles", ["license_plate"], unique=True)
    op.drop_constraint("uq_parking_space_tenant_level_number", "parking_spaces", type_="unique")
    op.drop_index("ix_parking_spaces_is_active", table_name="parking_spaces")
    op.drop_column("parking_spaces", "is_active")
    op.drop_column("parking_sessions", "discount_percent")
    for table in ("whitelist_entries", "vehicles", "parking_sessions", "parking_spaces", "admin_settings", "admin_users"):
        op.drop_index(f"ix_{table}_tenant_id", table_name=table)
        op.drop_constraint(f"fk_{table}_tenant", table, type_="foreignkey")
        op.drop_column(table, "tenant_id")
    op.drop_table("tenants")
