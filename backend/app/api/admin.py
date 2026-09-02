from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session
from sqlalchemy import Integer, func

from app.database.database import get_db
from app.models.whitelist_entry import WhitelistEntry
from app.services.auth_service import (
    authenticate_admin,
    create_access_token,
    get_current_admin,
)
from app.services.settings_service import get_admin_settings, settings_response
from app.services.activity_service import log_admin_activity
from app.services.garage_service import sync_parking_spaces
from app.models.parking_session import ParkingSession
from app.models.vehicle import Vehicle
from app.services.time_service import pakistan_now
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
    automatic_entry: bool = False

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
    admin=Depends(current_admin),
):
    return settings_response(get_admin_settings(db, admin.tenant_id))


@router.put("/settings/garage")
def save_garage_settings(
    request: GarageSettingsRequest,
    db: Session = Depends(get_db),
    admin=Depends(current_admin),
):
    settings = get_admin_settings(db, admin.tenant_id, create=True)
    old_value = dict(settings.garage_settings)

    # Save the admin configuration
    settings.garage_settings = request.model_dump()

    sync_parking_spaces(db, admin.tenant_id, settings.garage_settings["levels"])
    log_admin_activity(db, admin, "garage_settings.updated", old_value, settings.garage_settings)
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
    admin=Depends(current_admin),
):
    settings = get_admin_settings(db, admin.tenant_id, create=True)
    old_value = dict(settings.camera_config)
    settings.camera_config = request.model_dump()
    log_admin_activity(db, admin, "camera_config.updated", old_value, settings.camera_config)
    db.commit()
    db.refresh(settings)
    return {"success": True, "camera_config": settings.camera_config}


@router.put("/settings/billing")
def save_billing_config(
    request: BillingConfigRequest,
    db: Session = Depends(get_db),
    admin=Depends(current_admin),
):
    settings = get_admin_settings(db, admin.tenant_id, create=True)
    old_value = dict(settings.billing_config)
    settings.billing_config = request.model_dump()
    log_admin_activity(db, admin, "billing_config.updated", old_value, settings.billing_config)
    db.commit()
    db.refresh(settings)
    return {"success": True, "billing_config": settings.billing_config}


@router.get("/whitelist")
def get_whitelist(
    db: Session = Depends(get_db),
    admin=Depends(current_admin),
):
    entries = db.query(WhitelistEntry).filter(WhitelistEntry.tenant_id == admin.tenant_id).order_by(WhitelistEntry.vehicle_name.asc()).all()
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
    admin=Depends(current_admin),
):
    license_plate = request.license_plate.strip().upper()
    vehicle_name = request.vehicle_name.strip()
    if not vehicle_name:
        raise HTTPException(status_code=422, detail="Vehicle name is required.")

    existing = (
        db.query(WhitelistEntry)
        .filter(WhitelistEntry.tenant_id == admin.tenant_id, WhitelistEntry.license_plate == license_plate)
        .first()
    )
    if existing:
        raise HTTPException(
            status_code=409, detail="This number plate is already whitelisted."
        )

    entry = WhitelistEntry(
        tenant_id=admin.tenant_id,
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
    admin=Depends(current_admin),
):
    search = request.search.strip()
    entry = (
        db.query(WhitelistEntry)
        .filter(
            WhitelistEntry.tenant_id == admin.tenant_id,
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


@router.get("/activity")
def parking_activity(db: Session = Depends(get_db), admin=Depends(current_admin)):
    tenant_id = admin.tenant_id
    settings = settings_response(get_admin_settings(db, tenant_id))
    all_spaces = db.query(ParkingSpace).filter(ParkingSpace.tenant_id == tenant_id).order_by(ParkingSpace.level, func.cast(func.substring(ParkingSpace.space_number, r"\d+$"), Integer)).all()
    spaces = [space for space in all_spaces if space.is_active]
    sessions = db.query(ParkingSession).filter(ParkingSession.tenant_id == tenant_id).order_by(ParkingSession.entry_time.desc()).all()
    vehicles = {vehicle.id: vehicle for vehicle in db.query(Vehicle).filter(Vehicle.tenant_id == tenant_id).all()}
    whitelist = {entry.license_plate: entry for entry in db.query(WhitelistEntry).filter(WhitelistEntry.tenant_id == tenant_id).all()}
    active_by_space = {session.parking_space_id: session for session in sessions if session.status == "active"}
    live_sessions = [
        {"plate": vehicles[session.vehicle_id].license_plate, "space": next((space.space_number for space in all_spaces if space.id == session.parking_space_id), None), "entry_time": session.entry_time, "duration_minutes": int((pakistan_now() - session.entry_time).total_seconds() // 60)}
        for session in sessions if session.status == "active" and session.vehicle_id in vehicles
    ]
    history = [
        {"plate": vehicles[session.vehicle_id].license_plate, "entry_time": session.entry_time, "exit_time": session.exit_time, "duration_minutes": int((session.exit_time - session.entry_time).total_seconds() // 60) if session.exit_time else 0, "space": next((space.space_number for space in all_spaces if space.id == session.parking_space_id), None), "payment_method": session.payment_method, "amount": session.amount, "discount_percent": session.discount_percent if session.discount_percent is not None else (whitelist.get(vehicles[session.vehicle_id].license_plate).discount_percent if vehicles[session.vehicle_id].license_plate in whitelist else 0)}
        for session in sessions if session.status == "completed" and session.vehicle_id in vehicles
    ]
    vehicle_rows = []
    for vehicle in vehicles.values():
        vehicle_sessions = [session for session in sessions if session.vehicle_id == vehicle.id]
        active = next((session for session in vehicle_sessions if session.status == "active"), None)
        completed = [session for session in vehicle_sessions if session.exit_time]
        vehicle_rows.append({"plate": vehicle.license_plate, "total_visits": len(vehicle_sessions), "last_entry": max((session.entry_time for session in vehicle_sessions), default=None), "last_exit": max((session.exit_time for session in completed), default=None), "currently_parked": bool(active), "whitelisted": vehicle.license_plate in whitelist})
    return {"live_sessions": live_sessions, "history": history, "space_status": {"total_active_capacity": len(spaces), "occupied": sum(space.is_occupied for space in spaces), "available": sum(not space.is_occupied for space in spaces), "spaces": [{"level": space.level, "space": space.space_number, "is_occupied": space.is_occupied, "plate": vehicles.get(active_by_space[space.id].vehicle_id).license_plate if space.id in active_by_space and active_by_space[space.id].vehicle_id in vehicles else None} for space in spaces]}, "vehicles": vehicle_rows, "billing_enabled": bool(settings["billing_config"].get("payments_enabled"))}


@router.get("/activity/log")
def admin_activity_log(db: Session = Depends(get_db), admin=Depends(current_admin)):
    from app.models.admin_activity import AdminActivity
    entries = db.query(AdminActivity).filter(AdminActivity.tenant_id == admin.tenant_id).order_by(AdminActivity.created_at.desc()).limit(100).all()
    return {"entries": [{"action": entry.action, "old_value": entry.old_value, "new_value": entry.new_value, "created_at": entry.created_at} for entry in entries]}
