from datetime import datetime

from sqlalchemy.orm import Session

from app.models.parking_session import ParkingSession
from app.models.parking_space import ParkingSpace
from app.models.qr_code import QRCode
from app.models.vehicle import Vehicle
from app.services.billing_service import calculate_parking_fee


def process_vehicle_exit_by_qr(
    db: Session,
    qr_code_value: str,
):
    qr_code = (
        db.query(QRCode)
        .filter(QRCode.code == qr_code_value)
        .first()
    )

    if qr_code is None:
        raise ValueError("QR code not found")

    session = (
        db.query(ParkingSession)
        .filter(
            ParkingSession.id == qr_code.session_id,
            ParkingSession.status == "active",
        )
        .first()
    )

    if session is None:
        raise ValueError("No active parking session found")

    return complete_parking_session(db, session)


def process_vehicle_exit_by_plate(
    db: Session,
    license_plate: str,
):
    vehicle = (
        db.query(Vehicle)
        .filter(Vehicle.license_plate == license_plate)
        .first()
    )

    if vehicle is None:
        raise ValueError("Vehicle not found")

    session = (
        db.query(ParkingSession)
        .filter(
            ParkingSession.vehicle_id == vehicle.id,
            ParkingSession.status == "active",
        )
        .first()
    )

    if session is None:
        raise ValueError("No active parking session found")

    return complete_parking_session(db, session)


def complete_parking_session(
    db: Session,
    session: ParkingSession,
):
    exit_time = datetime.now()

    amount, billed_hours = calculate_parking_fee(
        session.entry_time,
        exit_time,
    )

    session.exit_time = exit_time
    session.amount = amount
    session.status = "completed"

    parking_space = (
        db.query(ParkingSpace)
        .filter(ParkingSpace.id == session.parking_space_id)
        .first()
    )

    if parking_space is not None:
        parking_space.is_occupied = False

    db.commit()

    db.refresh(session)

    vehicle = (
        db.query(Vehicle)
        .filter(Vehicle.id == session.vehicle_id)
        .first()
    )

    return {
        "session_id": session.id,
        "license_plate": vehicle.license_plate,
        "entry_time": session.entry_time,
        "exit_time": session.exit_time,
        "duration_hours": billed_hours,
        "amount": session.amount,
        "level": parking_space.level if parking_space else None,
        "space": parking_space.space_number if parking_space else None,
        "status": session.status,
    }