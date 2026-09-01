import os

from dotenv import load_dotenv

from app.logging_config import configure_logging

from app.api.vision import router as vision_router
from app.api.admin import router as admin_router

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database.database import engine
from app.database.database import get_db

from app.services.parking_service import (
    get_all_spaces,
)
from app.services.settings_service import get_admin_settings, settings_response

from app.schemas.parking import (
    VehicleEntryRequest,
    VehicleExitRequest,
)

from app.services.entry_service import (
    create_vehicle_entry,
)

from app.services.exit_service import (
    process_vehicle_exit_by_plate,
    payment_required_for_exit,
)

configure_logging()

load_dotenv()

cors_origins = [
    origin.strip()
    for origin in os.getenv(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]

app = FastAPI(
    title="Parking Garage API",
    description=("Backend API for the number plate recognition " "parking system"),
    version="2.0.0",
)


# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(vision_router)
app.include_router(admin_router)


# ============================================================
# Root
# ============================================================


@app.get("/")
def root():
    return {"message": "Parking Garage API is running"}


# ============================================================
# Health Check
# ============================================================


@app.get("/health")
def health_check():
    return {"status": "healthy"}


# ============================================================
# Database Test
# ============================================================


@app.get("/database-test")
def database_test():

    with engine.connect() as connection:

        result = connection.execute(text("SELECT current_database()"))

        database_name = result.scalar()

    return {
        "status": "connected",
        "database": database_name,
    }


# ============================================================
# Get All Parking Spaces
# ============================================================


@app.get("/garage/settings")
def garage_settings(
    db: Session = Depends(get_db),
):
    settings = settings_response(get_admin_settings(db))

    return {
        "success": True,
        "garage_settings": settings["garage_settings"],
        "camera_config": settings["camera_config"],
        "billing_config": settings["billing_config"],
    }

@app.get("/parking/spaces")
def parking_spaces(
    db: Session = Depends(get_db),
):
    """
    Return all parking spaces.

    Occupied spaces also include the currently parked
    vehicle's license plate and entry time.
    """

    spaces = get_all_spaces(db)

    return {
        "success": True,
        "spaces": spaces,
    }


# ============================================================
# Vehicle Entry
# ============================================================


@app.post("/parking/entry")
def vehicle_entry(
    request: VehicleEntryRequest,
    db: Session = Depends(get_db),
):
    """
    Register a vehicle entering the garage.

    The license plate is expected to come from the
    recognition system.

    The user only chooses the parking space.
    """

    try:

        result = create_vehicle_entry(
            db=db,
            license_plate=request.license_plate,
            parking_space_id=request.parking_space_id,
        )

        return {
            "success": True,
            "vehicle": result,
        }

    except ValueError as error:

        return {
            "success": False,
            "error": str(error),
        }


# ============================================================
# Vehicle Exit
# ============================================================


@app.get("/parking/exit/payment-required")
def exit_payment_required(
    license_plate: str,
    db: Session = Depends(get_db),
):
    billing_enabled = bool(
        settings_response(get_admin_settings(db))["billing_config"].get("payments_enabled")
    )
    return {
        "success": True,
        "payment_required": payment_required_for_exit(
            db,
            license_plate,
            billing_enabled,
        ),
    }


@app.post("/parking/exit")
def vehicle_exit(
    request: VehicleExitRequest,
    db: Session = Depends(get_db),
):
    """
    Complete a vehicle's parking session.

    The license plate is expected to come from the
    exit camera recognition system.
    """

    try:
        billing_config = settings_response(
            get_admin_settings(db)
        )["billing_config"]

        payment_required = payment_required_for_exit(
            db,
            request.license_plate,
            bool(billing_config.get("payments_enabled")),
        )

        if payment_required and not request.payment_method:
            raise ValueError("Select a payment method before exiting.")

        result = process_vehicle_exit_by_plate(
            db=db,
            license_plate=request.license_plate,
            payment_method=(
                request.payment_method
                if billing_config.get("payments_enabled")
                else None
            ),
            billing_enabled=bool(billing_config.get("payments_enabled")),
        )

        return {
            "success": True,
            "vehicle": result,
        }

    except ValueError as error:

        return {
            "success": False,
            "error": str(error),
        }
