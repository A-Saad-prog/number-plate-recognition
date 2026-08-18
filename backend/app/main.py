from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware

from pydantic import BaseModel

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database.database import engine
from app.database.database import get_db

from app.services.parking_service import (
    get_all_spaces,
)

from app.schemas.parking import (
    VehicleEntryRequest,
    VehicleExitRequest,
)

from app.services.entry_service import (
    create_vehicle_entry,
)

from app.services.exit_service import (
    process_vehicle_exit_by_plate,
)


app = FastAPI(
    title="Parking Garage API",
    description=(
        "Backend API for the number plate recognition "
        "parking system"
    ),
    version="2.0.0",
)


# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# Latest Detected License Plate
# ============================================================

latest_detected_plate = None


# ============================================================
# Root
# ============================================================

@app.get("/")
def root():
    return {
        "message": "Parking Garage API is running"
    }


# ============================================================
# Health Check
# ============================================================

@app.get("/health")
def health_check():
    return {
        "status": "healthy"
    }


# ============================================================
# Database Test
# ============================================================

@app.get("/database-test")
def database_test():

    with engine.connect() as connection:

        result = connection.execute(
            text("SELECT current_database()")
        )

        database_name = result.scalar()

    return {
        "status": "connected",
        "database": database_name,
    }


# ============================================================
# Get All Parking Spaces
# ============================================================

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

        result = process_vehicle_exit_by_plate(
            db=db,
            license_plate=request.license_plate,
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
# Detected Plate Request
# ============================================================

class DetectedPlateRequest(BaseModel):
    license_plate: str


# ============================================================
# Receive Detected Plate From Camera
# ============================================================

@app.post("/parking/detected-plate")
def detected_plate(
    request: DetectedPlateRequest,
):
    global latest_detected_plate

    latest_detected_plate = (
        request.license_plate
        .strip()
        .upper()
    )

    return {
        "success": True,
        "license_plate": latest_detected_plate,
    }


# ============================================================
# Get Latest Detected Plate
# ============================================================

@app.get("/parking/detected-plate")
def get_detected_plate():

    return {
        "success": True,
        "license_plate": latest_detected_plate,
    }