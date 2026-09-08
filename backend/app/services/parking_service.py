from sqlalchemy import Integer, func
from sqlalchemy.orm import Session

from app.models.parking_space import ParkingSpace
from app.models.parking_session import ParkingSession
from app.models.vehicle import Vehicle


def space_has_active_session(
    db: Session,
    space_id: int,
    tenant_id: int,
) -> bool:
    return (
        db.query(ParkingSession.id)
        .filter(
            ParkingSession.parking_space_id == space_id,
            ParkingSession.tenant_id == tenant_id,
            ParkingSession.status == "active",
        )
        .first()
        is not None
    )


def get_all_spaces(
    db: Session,
    tenant_id: int,
):
    """
    Return all active parking spaces with current
    active vehicle information.
    """

    ranked_sessions = (
        db.query(
            ParkingSession.parking_space_id.label("parking_space_id"),
            ParkingSession.vehicle_id.label("vehicle_id"),
            ParkingSession.entry_time.label("entry_time"),
            func.row_number()
            .over(
                partition_by=ParkingSession.parking_space_id,
                order_by=ParkingSession.entry_time.asc(),
            )
            .label("rn"),
        )
        .filter(
            ParkingSession.tenant_id == tenant_id,
            ParkingSession.status == "active",
            ParkingSession.exit_time == None,
        )
        .subquery()
    )

    active_session = (
        db.query(ranked_sessions)
        .filter(ranked_sessions.c.rn == 1)
        .subquery()
    )

    rows = (
        db.query(
            ParkingSpace.id,
            ParkingSpace.level,
            ParkingSpace.space_number,
            active_session.c.entry_time,
            Vehicle.license_plate,
        )
        .outerjoin(
            active_session,
            active_session.c.parking_space_id == ParkingSpace.id,
        )
        .outerjoin(
            Vehicle,
            (Vehicle.id == active_session.c.vehicle_id)
            & (Vehicle.tenant_id == tenant_id),
        )
        .filter(
            ParkingSpace.tenant_id == tenant_id,
            ParkingSpace.is_active == True,
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
        .all()
    )

    result = []

    for row in rows:
        actually_occupied = row.entry_time is not None

        result.append(
            {
                "id": row.id,
                "level": row.level,
                "space": row.space_number,
                "is_occupied": actually_occupied,
                "license_plate": row.license_plate if actually_occupied else None,
                "entry_time": row.entry_time,
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
        .populate_existing()
        .with_for_update()
        .first()
    )

    if space is None:
        raise ValueError(
            "Parking space does not exist"
        )

    if space.is_occupied or space_has_active_session(
        db,
        space.id,
        tenant_id,
    ):
        raise ValueError(
            "Parking space is already occupied"
        )

    return space