from sqlalchemy import Integer, func
from sqlalchemy.orm import Session

from app.models.parking_session import ParkingSession
from app.models.parking_space import ParkingSpace
from app.models.vehicle import Vehicle
from app.services.parking_service import (
    validate_available_space,
)
from app.services.time_service import pakistan_now


def create_vehicle_entry(
    db: Session,
    license_plate: str,
    tenant_id: int,
    parking_space_id: int | None = None,
    tracking_only: bool = False,
):
    """
    Create a parking session using a license plate
    recognized by the CV system. A selected space is
    used when provided; otherwise the first available
    space is assigned automatically.

    The backend validates the selected space before
    creating the session.
    """

    # ============================================================
    # Validate license plate
    # ============================================================

    license_plate = license_plate.strip().upper()

    if not license_plate:
        raise ValueError("License plate was not recognized")

    # ============================================================
    # Validate selected parking space
    # ============================================================

    # SQLAlchemy autobegins the transaction; hold space locks through commit.
    try:
        if tracking_only:
            space = None
        elif parking_space_id is None:
            space = (
                db.query(ParkingSpace)
                .filter(
                    ParkingSpace.is_occupied == False,
                    ParkingSpace.is_active == True,
                    ParkingSpace.tenant_id == tenant_id,
                )
                .order_by(
                    ParkingSpace.level.asc(),
                    func.cast(func.substring(ParkingSpace.space_number, r"\d+$"), Integer).asc(),
                )
                .populate_existing()
                .with_for_update(skip_locked=True)
                .first()
            )

            if space is None:
                raise ValueError("No available parking space")
        else:
            space = validate_available_space(
                db,
                parking_space_id, tenant_id,
            )

        # ============================================================
        # Find or create vehicle
        # ============================================================

        vehicle = db.query(Vehicle).filter(Vehicle.tenant_id == tenant_id, Vehicle.license_plate == license_plate).first()

        if vehicle is None:
            vehicle = Vehicle(tenant_id=tenant_id, license_plate=license_plate)

            db.add(vehicle)
            db.flush()

        # ============================================================
        # Prevent duplicate active parking sessions
        # ============================================================

        active_session = (
            db.query(ParkingSession)
            .filter(
                ParkingSession.vehicle_id == vehicle.id,
                ParkingSession.tenant_id == tenant_id,
                ParkingSession.status == "active",
            )
            .first()
        )

        if active_session is not None:
            raise ValueError("This vehicle is already inside the parking garage")

        # ============================================================
        # Create parking session
        # ============================================================

        if space:
            space.is_occupied = True

        session = ParkingSession(
            tenant_id=tenant_id,
            vehicle_id=vehicle.id,
            parking_space_id=space.id if space else None,
            entry_time=pakistan_now(),
            status="active",
        )

        db.add(session)

        db.commit()
    except Exception:
        db.rollback()
        raise

    db.refresh(session)
    db.refresh(vehicle)
    if space:
        db.refresh(space)

    return {
        "session_id": session.id,
        "license_plate": vehicle.license_plate,
        "entry_time": session.entry_time,
        "level": space.level if space else None,
        "space": space.space_number if space else None,
        "status": session.status,
    }
