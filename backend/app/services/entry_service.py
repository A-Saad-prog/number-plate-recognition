from datetime import datetime

from sqlalchemy.orm import Session

from app.models.parking_session import ParkingSession
from app.models.parking_space import ParkingSpace
from app.models.vehicle import Vehicle
from app.services.parking_service import validate_available_space


def create_vehicle_entry(
    db: Session,
    license_plate: str,
    parking_space_id: int,
):
    """
    Create a parking session using a license plate
    recognized by the CV system and a parking space
    selected by the user.

    The backend validates the selected space before
    creating the session.
    """

    # ============================================================
    # Validate license plate
    # ============================================================

    license_plate = license_plate.strip().upper()

    if not license_plate:
        raise ValueError(
            "License plate was not recognized"
        )

    # ============================================================
    # Validate selected parking space
    # ============================================================

    space = validate_available_space(
        db,
        parking_space_id,
    )

    # ============================================================
    # Find or create vehicle
    # ============================================================

    vehicle = (
        db.query(Vehicle)
        .filter(
            Vehicle.license_plate == license_plate
        )
        .first()
    )

    if vehicle is None:
        vehicle = Vehicle(
            license_plate=license_plate
        )

        db.add(vehicle)
        db.flush()

    # ============================================================
    # Prevent duplicate active parking sessions
    # ============================================================

    active_session = (
        db.query(ParkingSession)
        .filter(
            ParkingSession.vehicle_id == vehicle.id,
            ParkingSession.status == "active",
        )
        .first()
    )

    if active_session is not None:
        raise ValueError(
            "This vehicle is already inside the parking garage"
        )

    # ============================================================
    # Create parking session
    # ============================================================

    space.is_occupied = True

    session = ParkingSession(
        vehicle_id=vehicle.id,
        parking_space_id=space.id,
        entry_time=datetime.now(),
        status="active",
    )

    db.add(session)

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise

    db.refresh(session)
    db.refresh(vehicle)
    db.refresh(space)

    return {
        "session_id": session.id,
        "license_plate": vehicle.license_plate,
        "entry_time": session.entry_time,
        "level": space.level,
        "space": space.space_number,
        "status": session.status,
    }