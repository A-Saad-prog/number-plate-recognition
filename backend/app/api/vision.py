import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.plate_recognition import detect_plate

logger = logging.getLogger(__name__)

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

        result = detect_plate(
            request.image,
            request.source,
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
