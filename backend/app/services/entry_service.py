from sqlalchemy import Integer, func
from sqlalchemy.orm import Session

from app.models.parking_session import ParkingSession
from app.models.parking_space import ParkingSpace
from app.models.vehicle import Vehicle
from app.services.parking_service import (
    validate_available_space,
)
from app.services.time_service import pakistan_now


def _find_available_space(db: Session, tenant_id: int):
    # Do not trust only ParkingSpace.is_occupied.
    # A stale flag must never allow a space with an
    # existing active session to be allocated again.
    active_session_exists = (
        db.query(ParkingSession.id)
        .filter(
            ParkingSession.parking_space_id == ParkingSpace.id,
            ParkingSession.tenant_id == tenant_id,
            ParkingSession.status == "active",
        )
        .exists()
    )

    return (
        db.query(ParkingSpace)
        .filter(
            ParkingSpace.is_occupied == False,
            ParkingSpace.is_active == True,
            ParkingSpace.tenant_id == tenant_id,
            ~active_session_exists,
        )
        .order_by(
            ParkingSpace.level.asc(),
            func.cast(
                func.substring(
                    ParkingSpace.space_number,
                    r"\d+$",
                ),
                Integer,
            ).asc(),
        )
        .populate_existing()
        .with_for_update(skip_locked=True)
        .first()
    )


def create_vehicle_entry(
    db: Session,
    license_plate: str,
    tenant_id: int,
    parking_space_id: int | None = None,
):
    """
    Create a parking session using a license plate
    recognized by the CV system.

    If a parking space is explicitly provided, validate
    and lock that space.

    If no parking space is provided, automatically select
    the first truly available space while safely handling
    concurrent entry requests.
    """

    # ============================================================
    # Validate license plate
    # ============================================================

    license_plate = license_plate.strip().upper()

    if not license_plate:
        raise ValueError(
            "License plate was not recognized"
        )

    try:
        # ========================================================
        # Select / validate parking space
        # ========================================================

        if parking_space_id is None:
            # PLATE_TRACKING_SPACE_LOG_V1
            # Tracking-only mode always calls this with no explicit
            # parking_space_id, so it goes through the exact same
            # automatic space-selection path as Parking Garage mode --
            # the frontend just never displays the assigned space for a
            # tracking-only garage.
            space = _find_available_space(db, tenant_id)

            if space is None:
                raise ValueError(
                    "No available parking space"
                )

        else:
            space = validate_available_space(
                db,
                parking_space_id,
                tenant_id,
            )

        # ========================================================
        # Find or create vehicle
        # ========================================================

        vehicle = (
            db.query(Vehicle)
            .filter(
                Vehicle.tenant_id == tenant_id,
                Vehicle.license_plate == license_plate,
            )
            .first()
        )

        if vehicle is None:
            vehicle = Vehicle(
                tenant_id=tenant_id,
                license_plate=license_plate,
            )

            db.add(vehicle)
            db.flush()

        # ========================================================
        # Prevent duplicate active session for same vehicle
        # ========================================================

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
            raise ValueError(
                "This vehicle is already inside the parking garage"
            )

        # ========================================================
        # Extra defensive space check
        # ========================================================

        if space is not None:

            conflicting_session = (
                db.query(ParkingSession.id)
                .filter(
                    ParkingSession.parking_space_id == space.id,
                    ParkingSession.tenant_id == tenant_id,
                    ParkingSession.status == "active",
                )
                .first()
            )

            if conflicting_session is not None:
                raise ValueError(
                    "Parking space is already occupied"
                )

            space.is_occupied = True

        # ========================================================
        # Create parking session
        # ========================================================

        session = ParkingSession(
            tenant_id=tenant_id,
            vehicle_id=vehicle.id,
            parking_space_id=space.id if space else None,
            entry_time=pakistan_now(),
            status="active",
        )

        db.add(session)

        # Flush first so DB-level constraints fail here inside
        # the controlled transaction rather than later.
        db.flush()

        db.commit()

    except Exception:
        db.rollback()
        raise

    # ============================================================
    # Refresh committed objects
    # ============================================================

    db.refresh(session)
    db.refresh(vehicle)

    if space:
        db.refresh(space)

    # ============================================================
    # Response
    # ============================================================

    return {
        "session_id": session.id,
        "license_plate": vehicle.license_plate,
        "entry_time": session.entry_time,
        "level": space.level if space else None,
        "space": space.space_number if space else None,
        "status": session.status,
    }