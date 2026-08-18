from sqlalchemy.orm import Session

from app.models.parking_space import ParkingSpace


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
) -> list[ParkingSpace]:
    """
    Return all parking spaces.

    Used by the frontend to render the complete
    2-level parking layout.
    """

    return (
        db.query(ParkingSpace)
        .order_by(
            ParkingSpace.level.asc(),
            ParkingSpace.id.asc(),
        )
        .all()
    )


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