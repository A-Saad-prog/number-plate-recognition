import os
import logging
import time

import numpy as np

from dotenv import load_dotenv

from app.logging_config import configure_logging

from app.api.vision import router as vision_router
from app.api.admin import router as admin_router, current_admin

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database.database import engine
from app.database.database import get_db

from app.services.parking_service import (
    get_all_spaces,
)
from app.services.settings_service import get_admin_settings, settings_response
from app.services.plate_recognition import (
    ocr,
    yolo,
    CONFIDENCE_THRESHOLD,
    YOLO_IMGSZ,
    YOLO_DEVICE,
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
    payment_required_for_exit,
)
from app.services.billing_service import PARKING_RATE_PER_MINUTE

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


@app.on_event("startup")
def warm_up_vision_models():
    total_started_at = time.perf_counter()

    yolo_started_at = time.perf_counter()
    try:
        yolo_warmup_image = np.zeros(
            (YOLO_IMGSZ, YOLO_IMGSZ, 3),
            dtype=np.uint8,
        )
        inference_options = {
            "source": yolo_warmup_image,
            "conf": CONFIDENCE_THRESHOLD,
            "verbose": False,
            "imgsz": YOLO_IMGSZ,
        }
        if YOLO_DEVICE:
            inference_options["device"] = YOLO_DEVICE
        yolo.predict(**inference_options)
        yolo.predict(**inference_options)
        logging.getLogger(__name__).info(
            "YOLO warm-up completed in %.1fms",
            (time.perf_counter() - yolo_started_at) * 1000,
        )
    except Exception:
        logging.getLogger(__name__).warning(
            "YOLO warm-up failed after %.1fms; continuing startup",
            (time.perf_counter() - yolo_started_at) * 1000,
            exc_info=True,
        )

    ocr_started_at = time.perf_counter()
    try:
        ocr_warmup_image = np.full((64, 256, 3), 255, dtype=np.uint8)
        ocr_warmup_image_large = np.full((96, 320, 3), 255, dtype=np.uint8)
        list(ocr.predict(ocr_warmup_image))
        list(ocr.predict(ocr_warmup_image_large))
        list(ocr.predict(ocr_warmup_image))
        logging.getLogger(__name__).info(
            "OCR warm-up completed in %.1fms",
            (time.perf_counter() - ocr_started_at) * 1000,
        )
    except Exception:
        logging.getLogger(__name__).warning(
            "OCR warm-up failed after %.1fms; continuing startup",
            (time.perf_counter() - ocr_started_at) * 1000,
            exc_info=True,
        )

    logging.getLogger(__name__).info(
        "Vision model warm-up completed in %.1fms",
        (time.perf_counter() - total_started_at) * 1000,
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
    admin=Depends(current_admin),
):
    settings = settings_response(get_admin_settings(db, admin.tenant_id))

    return {
        "success": True,
        "garage_settings": settings["garage_settings"],
        "camera_config": settings["camera_config"],
        "billing_config": settings["billing_config"],
    }

@app.get("/parking/spaces")
def parking_spaces(
    db: Session = Depends(get_db),
    admin=Depends(current_admin),
):
    """
    Return all parking spaces.

    Occupied spaces also include the currently parked
    vehicle's license plate and entry time.
    """

    spaces = get_all_spaces(db, admin.tenant_id)

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
    admin=Depends(current_admin),
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
            tenant_id=admin.tenant_id,
            tracking_only=settings_response(get_admin_settings(db, admin.tenant_id))["garage_settings"].get("mode") == "tracking",
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
    admin=Depends(current_admin),
):
    billing_config = settings_response(get_admin_settings(db, admin.tenant_id))["billing_config"]
    billing_enabled = bool(billing_config.get("payments_enabled"))
    rate_per_minute = float(billing_config.get("rate_per_minute", PARKING_RATE_PER_MINUTE))
    rate_unit = billing_config.get("rate_unit", "minute")
    try:
        payment_required = payment_required_for_exit(
            db,
            license_plate,
            billing_enabled,
            admin.tenant_id,
            rate_per_minute,
            rate_unit,
        )
    except ValueError:
        raise HTTPException(
            status_code=404,
            detail="This vehicle is not parked in the garage.",
        ) from None

    return {
        "success": True,
        "payment_required": payment_required,
        "rate_per_minute": rate_per_minute,
        "rate_unit": rate_unit,
    }


@app.post("/parking/exit")
def vehicle_exit(
    request: VehicleExitRequest,
    db: Session = Depends(get_db),
    admin=Depends(current_admin),
):
    """
    Complete a vehicle's parking session.

    The license plate is expected to come from the
    exit camera recognition system.
    """

    try:
        billing_config = settings_response(
            get_admin_settings(db, admin.tenant_id)
        )["billing_config"]
        rate_per_minute = float(
            billing_config.get("rate_per_minute", PARKING_RATE_PER_MINUTE)
        )
        rate_unit = billing_config.get("rate_unit", "minute")

        payment_required = payment_required_for_exit(
            db,
            request.license_plate,
            bool(billing_config.get("payments_enabled")),
            admin.tenant_id,
            rate_per_minute,
            rate_unit,
        )

        if payment_required and not request.payment_method:
            raise ValueError("Select a payment method before exiting.")

        if payment_required and not billing_config.get(f"{request.payment_method}_enabled"):
            raise ValueError("Selected payment method is not enabled.")

        result = process_vehicle_exit_by_plate(
            db=db,
            license_plate=request.license_plate,
            payment_method=(
                request.payment_method
                if billing_config.get("payments_enabled")
                else None
            ),
            billing_enabled=bool(billing_config.get("payments_enabled")),
            rate_per_minute=rate_per_minute,
            rate_unit=rate_unit,
            tenant_id=admin.tenant_id,
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
