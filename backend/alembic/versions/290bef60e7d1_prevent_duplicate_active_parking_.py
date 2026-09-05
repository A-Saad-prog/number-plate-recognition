"""prevent duplicate active parking sessions

Revision ID: 290bef60e7d1
Revises: c3e5f7a9b102
Create Date: 2026-09-05 09:01:59.487094

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "290bef60e7d1"
down_revision: Union[str, Sequence[str], None] = "c3e5f7a9b102"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Repair duplicate active parking sessions,
    resync occupancy flags, and add hard database
    protection against future duplicates.
    """

    # ------------------------------------------------------------
    # 1. Remove duplicate active sessions sharing same space.
    #    Keep the oldest active session.
    # ------------------------------------------------------------
    op.execute(
        """
        WITH ranked AS (
            SELECT
                id,
                ROW_NUMBER() OVER (
                    PARTITION BY tenant_id, parking_space_id
                    ORDER BY entry_time ASC, id ASC
                ) AS rn
            FROM parking_sessions
            WHERE status = 'active'
              AND parking_space_id IS NOT NULL
        )
        UPDATE parking_sessions
        SET
            status = 'removed',
            exit_time = COALESCE(exit_time, CURRENT_TIMESTAMP)
        WHERE id IN (
            SELECT id
            FROM ranked
            WHERE rn > 1
        )
        """
    )

    # ------------------------------------------------------------
    # 2. Remove duplicate active sessions for same vehicle.
    #    Keep the oldest active session.
    # ------------------------------------------------------------
    op.execute(
        """
        WITH ranked AS (
            SELECT
                id,
                ROW_NUMBER() OVER (
                    PARTITION BY tenant_id, vehicle_id
                    ORDER BY entry_time ASC, id ASC
                ) AS rn
            FROM parking_sessions
            WHERE status = 'active'
        )
        UPDATE parking_sessions
        SET
            status = 'removed',
            exit_time = COALESCE(exit_time, CURRENT_TIMESTAMP)
        WHERE id IN (
            SELECT id
            FROM ranked
            WHERE rn > 1
        )
        """
    )

    # ------------------------------------------------------------
    # 3. Recalculate every parking space occupancy flag from
    #    actual active parking sessions.
    # ------------------------------------------------------------
    op.execute(
        """
        UPDATE parking_spaces AS ps
        SET is_occupied = EXISTS (
            SELECT 1
            FROM parking_sessions AS p
            WHERE p.parking_space_id = ps.id
              AND p.tenant_id = ps.tenant_id
              AND p.status = 'active'
        )
        """
    )

    # ------------------------------------------------------------
    # 4. Hard DB rule:
    #    only one active session may use a parking space.
    # ------------------------------------------------------------
    op.execute(
        """
        CREATE UNIQUE INDEX uq_active_parking_session_space
        ON parking_sessions (tenant_id, parking_space_id)
        WHERE status = 'active'
          AND parking_space_id IS NOT NULL
        """
    )

    # ------------------------------------------------------------
    # 5. Hard DB rule:
    #    only one active session may exist per vehicle.
    # ------------------------------------------------------------
    op.execute(
        """
        CREATE UNIQUE INDEX uq_active_parking_session_vehicle
        ON parking_sessions (tenant_id, vehicle_id)
        WHERE status = 'active'
        """
    )


def downgrade() -> None:
    """
    Remove duplicate-session database constraints.

    The repaired historical data is intentionally
    not restored.
    """

    op.execute(
        """
        DROP INDEX IF EXISTS uq_active_parking_session_vehicle
        """
    )

    op.execute(
        """
        DROP INDEX IF EXISTS uq_active_parking_session_space
        """
    )