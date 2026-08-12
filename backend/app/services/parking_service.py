from sqlalchemy.orm import Session

from app.models.parking_space import ParkingSpace


def get_available_space(db: Session) -> ParkingSpace | None:
    """
    Find the first available parking space.

    Level 1 is prioritized before Level 2.
    """

    space = (
        db.query(ParkingSpace)
        .filter(ParkingSpace.is_occupied == False)
        .order_by(
            ParkingSpace.level.asc(),
            ParkingSpace.id.asc(),
        )
        .first()
    )

    return space


def occupy_space(db: Session, space: ParkingSpace) -> None:
    """
    Mark a parking space as occupied.
    """

    space.is_occupied = True
    db.commit()


def release_space(db: Session, space: ParkingSpace) -> None:
    """
    Mark a parking space as available.
    """

    space.is_occupied = False
    db.commit()