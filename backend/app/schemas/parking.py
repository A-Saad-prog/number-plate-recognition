from pydantic import BaseModel, Field


class VehicleEntryRequest(BaseModel):
    license_plate: str = Field(
        min_length=1,
        max_length=20
    )
    
class VehicleExitQRRequest(BaseModel):
    qr_code: str = Field(
        min_length=1,
        max_length=100,
    )


class VehicleExitPlateRequest(BaseModel):
    license_plate: str = Field(
        min_length=1,
        max_length=20,
    )