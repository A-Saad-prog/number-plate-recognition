from sqlalchemy.orm import Session

from app.models.parking_space import ParkingSpace


def sync_parking_spaces(db: Session, tenant_id: int, levels: list[dict]) -> None:
    """Make configured spaces active while retaining removed spaces for history."""
    requested = {
        (level["id"], f"L{level['id']}-{number:02d}")
        for level in levels
        for number in range(1, level["spaces"] + 1)
    }
    existing = {
        (space.level, space.space_number): space
        for space in db.query(ParkingSpace).filter(ParkingSpace.tenant_id == tenant_id).all()
    }

    for key in requested:
        space = existing.get(key)
        if space:
            space.is_active = True
        else:
            db.add(ParkingSpace(tenant_id=tenant_id, level=key[0], space_number=key[1], is_occupied=False, is_active=True))

    for key, space in existing.items():
        if key not in requested:
            # Historical and active sessions retain their space; inactivity only prevents new assignment.
            space.is_active = False
