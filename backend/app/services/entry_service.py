from datetime import datetime

from sqlalchemy.orm import Session

from app.models.parking_session import ParkingSession
from app.models.parking_space import ParkingSpace
from app.models.qr_code import QRCode
from app.models.vehicle import Vehicle
from app.services.parking_service import get_available_space
from app.services.qr_service import (
    generate_qr_code,
    generate_qr_image,
)


def create_vehicle_entry(
    db: Session,
    license_plate: str,
):
    # Check if a parking space is available
    space = get_available_space(db)

    if space is None:
        raise ValueError("Parking garage is full")

    # Check if this vehicle already exists
    vehicle = (
        db.query(Vehicle)
        .filter(Vehicle.license_plate == license_plate)
        .first()
    )

    # Create vehicle if it doesn't exist
    if vehicle is None:
        vehicle = Vehicle(
            license_plate=license_plate
        )

        db.add(vehicle)
        db.flush()

    # Mark parking space as occupied
    space.is_occupied = True

    # Create parking session
    session = ParkingSession(
        vehicle_id=vehicle.id,
        parking_space_id=space.id,
        entry_time=datetime.now(),
        status="active",
    )

    db.add(session)
    db.flush()

    # Generate unique QR identifier
    qr_code_value = generate_qr_code()
    qr_image = generate_qr_image(qr_code_value)

    qr_code = QRCode(
        session_id=session.id,
        code=qr_code_value,
    )

    db.add(qr_code)

    db.commit()

    # Refresh objects from database
    db.refresh(session)
    db.refresh(qr_code)

    return {
        "session_id": session.id,
        "license_plate": vehicle.license_plate,
        "entry_time": session.entry_time,
        "level": space.level,
        "space": space.space_number,
        "qr_code": qr_code.code,
        "qr_image": qr_image,
    }