from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.whitelist_entry import WhitelistEntry
from app.services.auth_service import (
    authenticate_admin,
    create_access_token,
    get_current_admin,
)
from app.services.settings_service import get_admin_settings, settings_response
from fastapi import APIRouter, Depends, HTTPException, status
from app.models.parking_space import ParkingSpace

router = APIRouter(prefix="/admin", tags=["admin"])
bearer_scheme = HTTPBearer(auto_error=False)


class AdminLoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=128)


class WhitelistCreateRequest(BaseModel):
    license_plate: str = Field(min_length=1, max_length=20)
    vehicle_name: str = Field(min_length=1, max_length=100)
    discount_percent: float = Field(ge=0, le=100)


class WhitelistRemoveRequest(BaseModel):
    search: str = Field(min_length=1, max_length=100)


class GarageLevelRequest(BaseModel):
    id: int = Field(ge=1, le=12)
    name: str = Field(min_length=1, max_length=100)
    spaces: int = Field(ge=1, le=1000)


class GarageSettingsRequest(BaseModel):
    level_count: int = Field(ge=1, le=12)
    spaces_per_level: int = Field(ge=1, le=1000)
    levels: list[GarageLevelRequest] = Field(min_length=1, max_length=12)

    @model_validator(mode="after")
    def validate_level_layout(self):
        if len(self.levels) != self.level_count:
            raise ValueError("The number of levels must match level_count.")
        if len({level.id for level in self.levels}) != len(self.levels):
            raise ValueError("Each level must have a unique id.")
        return self


class CameraConfigRequest(BaseModel):
    entry_lane_cameras: int = Field(ge=1, le=4)
    exit_lane_cameras: int = Field(ge=1, le=4)


class BillingConfigRequest(BaseModel):
    payments_enabled: bool
    cash_enabled: bool
    card_enabled: bool

    @model_validator(mode="after")
    def validate_payment_methods(self):
        if not self.payments_enabled and (self.cash_enabled or self.card_enabled):
            raise ValueError(
                "Payment methods must be disabled when payments are disabled."
            )
        if self.payments_enabled and not (self.cash_enabled or self.card_enabled):
            raise ValueError(
                "Select at least one payment method when payments are enabled."
            )
        return self


def current_admin(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    token = credentials.credentials if credentials else None
    return get_current_admin(token, db)


@router.post("/login")
def admin_login(request: AdminLoginRequest, db: Session = Depends(get_db)):
    admin = authenticate_admin(db, request.username.strip(), request.password)
    if not admin:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return {"access_token": create_access_token(admin), "token_type": "bearer"}


@router.get("/me")
def admin_session(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    token = credentials.credentials if credentials else None
    admin = get_current_admin(token, db)
    return {"authenticated": True, "username": admin.username}


@router.get("/settings")
def get_settings(
    db: Session = Depends(get_db),
    _admin=Depends(current_admin),
):
    return settings_response(get_admin_settings(db))


@router.put("/settings/garage")
def save_garage_settings(
    request: GarageSettingsRequest,
    db: Session = Depends(get_db),
    _admin=Depends(current_admin),
):
    settings = get_admin_settings(db, create=True)

    # Save the admin configuration
    settings.garage_settings = request.model_dump()

    # Get the currently existing parking spaces
    existing_spaces = (
        db.query(ParkingSpace)
        .order_by(
            ParkingSpace.level.asc(),
            ParkingSpace.space_number.asc(),
        )
        .all()
    )

    # Requested layout
    requested_levels = {level.id: level for level in request.levels}

    import re

    def parse_space_num(val) -> int:
        match = re.search(r"\d+$", str(val))
        if match:
            return int(match.group(0))
        digits = "".join(filter(str.isdigit, str(val)))
        return int(digits) if digits else 0

    # Synchronize parking spaces with the new configuration
    for level_id, level_config in requested_levels.items():
        for space_number in range(1, level_config.spaces + 1):
            expected_str = f"L{level_id}-{space_number:02d}"
            existing = next(
                (
                    space
                    for space in existing_spaces
                    if space.level == level_id
                    and (
                        parse_space_num(space.space_number) == space_number
                        or str(space.space_number) == expected_str
                    )
                ),
                None,
            )

            if existing:
                continue

            new_space = ParkingSpace(
                level=level_id,
                space_number=expected_str,
                is_occupied=False,
            )

            db.add(new_space)

    # Remove spaces that are outside the new configuration
    for space in existing_spaces:
        level_config = requested_levels.get(space.level)
        space_num = parse_space_num(space.space_number)

        should_exist = (
            level_config is not None
            and space_num > 0
            and space_num <= level_config.spaces
        )

        if not should_exist:
            # Clean up any sessions associated with this removed space
            db.delete(space)

    db.commit()
    db.refresh(settings)

    return {
        "success": True,
        "garage_settings": settings.garage_settings,
    }


@router.put("/settings/cameras")
def save_camera_config(
    request: CameraConfigRequest,
    db: Session = Depends(get_db),
    _admin=Depends(current_admin),
):
    settings = get_admin_settings(db, create=True)
    settings.camera_config = request.model_dump()
    db.commit()
    db.refresh(settings)
    return {"success": True, "camera_config": settings.camera_config}


@router.put("/settings/billing")
def save_billing_config(
    request: BillingConfigRequest,
    db: Session = Depends(get_db),
    _admin=Depends(current_admin),
):
    settings = get_admin_settings(db, create=True)
    settings.billing_config = request.model_dump()
    db.commit()
    db.refresh(settings)
    return {"success": True, "billing_config": settings.billing_config}


@router.get("/whitelist")
def get_whitelist(
    db: Session = Depends(get_db),
    _admin=Depends(current_admin),
):
    entries = db.query(WhitelistEntry).order_by(WhitelistEntry.vehicle_name.asc()).all()
    return {
        "entries": [
            {
                "id": entry.id,
                "license_plate": entry.license_plate,
                "vehicle_name": entry.vehicle_name,
                "discount_percent": entry.discount_percent,
                "created_at": entry.created_at,
            }
            for entry in entries
        ]
    }


@router.post("/whitelist", status_code=status.HTTP_201_CREATED)
def add_whitelist_entry(
    request: WhitelistCreateRequest,
    db: Session = Depends(get_db),
    _admin=Depends(current_admin),
):
    license_plate = request.license_plate.strip().upper()
    vehicle_name = request.vehicle_name.strip()
    if not vehicle_name:
        raise HTTPException(status_code=422, detail="Vehicle name is required.")

    existing = (
        db.query(WhitelistEntry)
        .filter(WhitelistEntry.license_plate == license_plate)
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=409, detail="This number plate is already whitelisted."
        )

    entry = WhitelistEntry(
        license_plate=license_plate,
        vehicle_name=vehicle_name,
        discount_percent=request.discount_percent,
    )
    db.add(entry)
    db.commit()
    db.refresh(entry)
    return {"success": True, "entry": entry}


@router.delete("/whitelist")
def remove_whitelist_entry(
    request: WhitelistRemoveRequest,
    db: Session = Depends(get_db),
    _admin=Depends(current_admin),
):
    search = request.search.strip()
    entry = (
        db.query(WhitelistEntry)
        .filter(
            (WhitelistEntry.license_plate == search.upper())
            | (WhitelistEntry.vehicle_name.ilike(search))
        )
        .first()
    )
    if not entry:
        raise HTTPException(
            status_code=404, detail="No whitelisted vehicle matched that name or plate."
        )

    db.delete(entry)
    db.commit()
    return {"success": True, "removed": search}
