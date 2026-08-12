from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware

from sqlalchemy import text
from sqlalchemy.orm import Session

from pydantic import BaseModel

from app.database.database import engine
from app.database.database import get_db

from app.services.parking_service import get_available_space

from app.schemas.parking import (
    VehicleEntryRequest,
    VehicleExitPlateRequest,
    VehicleExitQRRequest,
)

from app.services.entry_service import create_vehicle_entry

from app.services.exit_service import (
    process_vehicle_exit_by_plate,
    process_vehicle_exit_by_qr,
)


app = FastAPI(
    title="Parking Garage API",
    description="Backend API for the number plate recognition parking system",
    version="1.0.0",
)


# ============================================================
# CORS
# ============================================================

# Allows the React frontend to communicate with FastAPI.

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
        "database": database_name
    }


# ============================================================
# Get Available Parking Space
# ============================================================

@app.get("/parking/available-space")
def available_space(
    db: Session = Depends(get_db)
):

    space = get_available_space(db)

    if space is None:

        return {
            "available": False,
            "message": "Parking garage is full",
        }

    return {
        "available": True,
        "level": space.level,
        "space": space.space_number,
    }


# ============================================================
# Vehicle Entry
# ============================================================

@app.post("/parking/entry")
def vehicle_entry(
    request: VehicleEntryRequest,
    db: Session = Depends(get_db),
):

    try:

        result = create_vehicle_entry(
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
# Vehicle Exit Using QR
# ============================================================

@app.post("/parking/exit/qr")
def vehicle_exit_qr(
    request: VehicleExitQRRequest,
    db: Session = Depends(get_db),
):

    try:

        result = process_vehicle_exit_by_qr(
            db=db,
            qr_code_value=request.qr_code,
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
# Vehicle Exit Using License Plate
# ============================================================

@app.post("/parking/exit/plate")
def vehicle_exit_plate(
    request: VehicleExitPlateRequest,
    db: Session = Depends(get_db),
):

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
    request: DetectedPlateRequest
):

    global latest_detected_plate

    latest_detected_plate = request.license_plate

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