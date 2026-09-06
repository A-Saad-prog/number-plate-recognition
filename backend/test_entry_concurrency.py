"""PostgreSQL integration tests; set ENTRY_TEST_DATABASE_URL to run.

Each test uses a private, randomly named schema and removes it afterward.
"""

import os
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session
from sqlalchemy.schema import CreateSchema, DropSchema

# Permit importing the application against a dedicated test database.
if os.getenv("ENTRY_TEST_DATABASE_URL"):
    os.environ.setdefault("DATABASE_URL", os.environ["ENTRY_TEST_DATABASE_URL"])

from app.database.database import Base
from app.models.parking_session import ParkingSession
from app.models.parking_space import ParkingSpace
from app.models.tenant import Tenant
from app.models.vehicle import Vehicle
from app.services.entry_service import create_vehicle_entry


@unittest.skipUnless(os.getenv("ENTRY_TEST_DATABASE_URL"), "ENTRY_TEST_DATABASE_URL is required")
class EntryConcurrencyTests(unittest.TestCase):
    def setUp(self):
        self.schema = "test_entry_" + uuid4().hex
        self.root_engine = create_engine(
            os.environ["ENTRY_TEST_DATABASE_URL"],
            connect_args={"options": "-c statement_timeout=10000 -c lock_timeout=5000"},
        )
        self.addCleanup(self.root_engine.dispose)
        with self.root_engine.begin() as connection:
            connection.execute(CreateSchema(self.schema))
        self.addCleanup(self.drop_schema)
        self.engine = self.root_engine.execution_options(schema_translate_map={None: self.schema})
        Base.metadata.create_all(self.engine, tables=[
            Tenant.__table__, Vehicle.__table__, ParkingSpace.__table__, ParkingSession.__table__,
        ])
        with Session(self.engine) as db:
            db.add_all([Tenant(id=1, name="Entry test"), Tenant(id=2, name="Other tenant")])
            db.flush()
            db.add_all([
                ParkingSpace(id=1, tenant_id=1, level=1, space_number="L1-02"),
                ParkingSpace(id=2, tenant_id=1, level=1, space_number="L1-10"),
                ParkingSpace(id=3, tenant_id=1, level=2, space_number="L2-01"),
                ParkingSpace(id=4, tenant_id=1, level=0, space_number="L0-01", is_active=False),
                ParkingSpace(id=5, tenant_id=1, level=0, space_number="L0-02", is_occupied=True),
                ParkingSpace(id=6, tenant_id=2, level=0, space_number="L0-01"),
            ])
            db.commit()

    def drop_schema(self):
        with self.root_engine.begin() as connection:
            connection.execute(DropSchema(self.schema, cascade=True))

    def test_three_automatic_entries_select_distinct_spaces_before_any_commit(self):
        barrier = threading.Barrier(3, timeout=8)

        def enter(index):
            with Session(self.engine, autoflush=False) as db:
                event.listen(db, "before_commit", lambda session: barrier.wait())
                return create_vehicle_entry(db, f"AUTO-{index}", 1)

        with ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(enter, range(3)))
        self.assertEqual({r["space"] for r in results}, {"L1-02", "L1-10", "L2-01"})
        with Session(self.engine) as db:
            sessions = db.scalars(select(ParkingSession)).all()
            self.assertEqual(len(sessions), 3)
            self.assertEqual(len({s.parking_space_id for s in sessions}), 3)
            self.assertTrue(all(db.get(ParkingSpace, s.parking_space_id).is_occupied for s in sessions))

    def test_ordering_filters_and_full_garage_error(self):
        with Session(self.engine) as db:
            for index, expected in enumerate(["L1-02", "L1-10", "L2-01"]):
                self.assertEqual(create_vehicle_entry(db, f"ORDER-{index}", 1)["space"], expected)
            with self.assertRaisesRegex(ValueError, "^No available parking space$"):
                create_vehicle_entry(db, "FULL", 1)
            self.assertFalse(db.in_transaction())

    def test_manual_contender_rechecks_occupancy_even_with_cached_space(self):
        selected = threading.Event()
        release = threading.Event()

        def first_entry():
            with Session(self.engine) as db:
                def hold_commit(session):
                    selected.set()
                    if not release.wait(8):
                        raise TimeoutError("Commit was not released")
                event.listen(db, "before_commit", hold_commit)
                return create_vehicle_entry(db, "MANUAL-FIRST", 1, parking_space_id=2)

        with Session(self.engine) as contender:
            cached = contender.get(ParkingSpace, 2)
            self.assertFalse(cached.is_occupied)
            with ThreadPoolExecutor(max_workers=1) as pool:
                first = pool.submit(first_entry)
                try:
                    self.assertTrue(selected.wait(8))
                    # Release the first transaction only when the contender is
                    # about to execute its locking SELECT on another connection.
                    def release_on_select(state):
                        release.set()
                    event.listen(contender, "do_orm_execute", release_on_select, once=True)
                    with self.assertRaisesRegex(ValueError, "^Parking space is already occupied$"):
                        create_vehicle_entry(contender, "MANUAL-SECOND", 1, parking_space_id=2)
                    self.assertEqual(first.result(timeout=8)["space"], "L1-10")
                finally:
                    release.set()

    def test_invalid_manual_space_preserves_error(self):
        with Session(self.engine) as db:
            for space_id in [4, 6, 999]:
                with self.assertRaisesRegex(ValueError, "^Parking space does not exist$"):
                    create_vehicle_entry(db, "INVALID", 1, parking_space_id=space_id)

    def test_failed_commit_rolls_back_reservation_and_session(self):
        with Session(self.engine) as db:
            def fail_commit(session):
                session.flush()
                raise RuntimeError("Injected commit failure")
            event.listen(db, "before_commit", fail_commit)
            with self.assertRaisesRegex(RuntimeError, "Injected commit failure"):
                create_vehicle_entry(db, "FAILED", 1)
            self.assertFalse(db.in_transaction())
        with Session(self.engine) as db:
            self.assertFalse(db.get(ParkingSpace, 1).is_occupied)
            self.assertEqual(db.query(ParkingSession).count(), 0)
            self.assertEqual(db.query(Vehicle).count(), 0)
            self.assertEqual(create_vehicle_entry(db, "RETRY", 1)["space"], "L1-02")


if __name__ == "__main__":
    unittest.main()
