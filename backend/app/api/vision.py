import logging
import os
import time

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.plate_recognition import detect_plate

logger = logging.getLogger(__name__)
VISION_DEBUG = os.getenv("VISION_DEBUG", "").lower() in {"1", "true", "yes"}

router = APIRouter(
    prefix="/vision",
    tags=["Vision"],
)


# ============================================================
# Request Models
# ============================================================

class PlateDetectionRequest(BaseModel):
    image: str
    source: str | None = None


# ============================================================
# Plate Detection
# ============================================================

@router.post("/detect-plate")
def detect_license_plate(
    request: PlateDetectionRequest,
):
    try:

        started_at = time.perf_counter()

        result = detect_plate(
            request.image,
            request.source,
        )

        if VISION_DEBUG:
            logger.info(
                "Vision endpoint timing source=%s total_ms=%.1f detected=%s accepted=%s",
                request.source or "default",
                (time.perf_counter() - started_at) * 1000,
                result.get("detected"),
                bool(result.get("license_plate")),
            )

        return {
            "success": True,
            **result,
        }

    except ValueError as error:

        raise HTTPException(
            status_code=400,
            detail=str(error),
        )

    except Exception as error:

        logger.exception(
            "Vision processing error"
        )

        raise HTTPException(
            status_code=500,
            detail="Plate recognition failed.",
        )
