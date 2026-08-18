from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware

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

    The frontend uses this to display the complete
    two-level parking layout.
    """

    spaces = get_all_spaces(db)

    return {
        "success": True,
        "spaces": [
            {
                "id": space.id,
                "level": space.level,
                "space": space.space_number,
                "is_occupied": space.is_occupied,
            }
            for space in spaces
        ],
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