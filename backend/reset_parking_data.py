from sqlalchemy import text

from app.database.database import SessionLocal
from app.models.parking_session import ParkingSession
from app.models.parking_space import ParkingSpace
from app.models.vehicle import Vehicle


db = SessionLocal()

try:
    # --------------------------------------------------------
    # Delete old QR codes directly from the database.
    #
    # The QRCode Python model was removed, but the old
    # qr_codes table still exists in PostgreSQL.
    # --------------------------------------------------------

    result = db.execute(
        text("DELETE FROM qr_codes")
    )

    deleted_qr_codes = result.rowcount

    # --------------------------------------------------------
    # Delete all parking sessions
    # --------------------------------------------------------

    deleted_sessions = (
        db.query(ParkingSession).delete()
    )

    # --------------------------------------------------------
    # Delete all vehicles
    # --------------------------------------------------------

    deleted_vehicles = (
        db.query(Vehicle).delete()
    )

    # --------------------------------------------------------
    # Reset all parking spaces
    # --------------------------------------------------------

    updated_spaces = (
        db.query(ParkingSpace)
        .update(
            {
                ParkingSpace.is_occupied: False
            }
        )
    )

    db.commit()

    print()
    print("==============================")
    print("PARKING DATA RESET")
    print("==============================")
    print(
        f"Deleted QR codes: {deleted_qr_codes}"
    )
    print(
        f"Deleted sessions: {deleted_sessions}"
    )
    print(
        f"Deleted vehicles: {deleted_vehicles}"
    )
    print(
        f"Reset parking spaces: {updated_spaces}"
    )
    print("==============================")
    print()

except Exception:
    db.rollback()
    raise

finally:
    db.close()