from sqlalchemy.orm import Session

from app.models.parking_space import ParkingSpace
from app.models.parking_session import ParkingSession
from app.models.vehicle import Vehicle


def get_available_spaces(
    db: Session,
) -> list[ParkingSpace]:
    """
    Return all available parking spaces.
    """

    return (
        db.query(ParkingSpace)
        .filter(
            ParkingSpace.is_occupied == False
        )
        .order_by(
            ParkingSpace.level.asc(),
            ParkingSpace.id.asc(),
        )
        .all()
    )


def get_all_spaces(
    db: Session,
):
    """
    Return all parking spaces.

    For occupied spaces, also return the currently
    parked vehicle's license plate and entry time.

    Available spaces return None for vehicle information.
    """

    spaces = (
        db.query(ParkingSpace)
        .order_by(
            ParkingSpace.level.asc(),
            ParkingSpace.id.asc(),
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
                    ParkingSession.parking_space_id
                    == space.id,
                    ParkingSession.status
                    == "active",
                    ParkingSession.exit_time
                    == None,
                )
                .first()
            )

            if session:

                vehicle = (
                    db.query(Vehicle)
                    .filter(
                        Vehicle.id
                        == session.vehicle_id
                    )
                    .first()
                )

                if vehicle:

                    license_plate = (
                        vehicle.license_plate
                    )

                entry_time = (
                    session.entry_time
                )

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
) -> ParkingSpace:
    """
    Validate that the requested parking space exists
    and is currently available.
    """

    space = (
        db.query(ParkingSpace)
        .filter(
            ParkingSpace.id == space_id
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