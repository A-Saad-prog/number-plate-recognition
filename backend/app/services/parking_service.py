from sqlalchemy import Integer, func
from sqlalchemy.orm import Session

from app.models.parking_space import ParkingSpace
from app.models.parking_session import ParkingSession
from app.models.vehicle import Vehicle


def get_available_spaces(
    db: Session,
    tenant_id: int,
) -> list[ParkingSpace]:
    """
    Return all available parking spaces.
    """

    return (
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
        .all()
    )


def get_all_spaces(
    db: Session,
    tenant_id: int,
):
    """
    Return all parking spaces with active vehicle
    information for occupied spaces.
    """

    spaces = (
        db.query(ParkingSpace)
        .filter(ParkingSpace.tenant_id == tenant_id, ParkingSpace.is_active == True)
        .order_by(
            ParkingSpace.level.asc(),
            func.cast(func.substring(ParkingSpace.space_number, r"\d+$"), Integer).asc(),
        )
        .all()
    )

    result = []

    for space in spaces:

        license_plate = None
        entry_time = None

        if space.is_occupied:

            session = (
                db.query(ParkingSession)
                .filter(
                    ParkingSession.parking_space_id == space.id,
                    ParkingSession.tenant_id == tenant_id,
                    ParkingSession.status == "active",
                    ParkingSession.exit_time == None,
                )
                .first()
            )

            if session:

                vehicle = (
                    db.query(Vehicle)
                    .filter(
                        Vehicle.id == session.vehicle_id,
                        Vehicle.tenant_id == tenant_id,
                    )
                    .first()
                )

                if vehicle:
                    license_plate = vehicle.license_plate

                entry_time = session.entry_time

        result.append(
            {
                "id": space.id,
                "level": space.level,
                "space": space.space_number,
                "is_occupied": space.is_occupied,
                "license_plate": license_plate,
                "entry_time": entry_time,
            }
        )

    return result


def validate_available_space(
    db: Session,
    space_id: int,
    tenant_id: int,
) -> ParkingSpace:

    space = (
        db.query(ParkingSpace)
        .filter(
            ParkingSpace.id == space_id,
            ParkingSpace.tenant_id == tenant_id,
            ParkingSpace.is_active == True,
        )
        .first()
    )

    if space is None:
        raise ValueError(
            "Parking space does not exist"
        )

    if space.is_occupied:
        raise ValueError(
            "Parking space is already occupied"
        )

    return space
