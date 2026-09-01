from typing import Literal, Optional

from pydantic import BaseModel, Field


class VehicleEntryRequest(BaseModel):
    license_plate: str = Field(
        min_length=1,
        max_length=20,
    )

    parking_space_id: Optional[int] = Field(
        default=None,
        gt=0,
    )


class VehicleExitRequest(BaseModel):
    license_plate: str = Field(
        min_length=1,
        max_length=20,
    )

    payment_method: Optional[Literal["cash", "card"]] = None
