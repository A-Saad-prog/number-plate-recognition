from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session
from sqlalchemy import Integer, func
from datetime import timedelta

from app.database.database import get_db
from app.models.whitelist_entry import WhitelistEntry
from app.services.auth_service import (
    authenticate_admin,
    create_access_token,
    get_current_admin,
)
from app.services.settings_service import get_admin_settings, settings_response
from app.services.garage_service import sync_parking_spaces
from app.models.parking_session import ParkingSession
from app.models.vehicle import Vehicle
from app.services.time_service import pakistan_now
from fastapi import APIRouter, Depends, HTTPException, status
from app.models.parking_space import ParkingSpace
from app.models.daily_parking_analytics import DailyParkingAnalytics
from app.services.daily_analytics_service import backfill_completed_days, live_day_metrics

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
    mode: str = "parking"
    level_count: int = Field(ge=0, le=12)
    spaces_per_level: int = Field(ge=0, le=1000)
    levels: list[GarageLevelRequest] = Field(default_factory=list, max_length=12)
    automatic_entry: bool = False
    local_image_saving: bool = False

    @model_validator(mode="after")
    def validate_level_layout(self):
        if self.mode not in {"parking", "tracking"}:
            raise ValueError("mode must be parking or tracking.")
        if self.mode == "tracking":
            return self
        if self.level_count < 1 or self.spaces_per_level < 1:
            raise ValueError("Parking mode requires at least one level and space.")
        if len(self.levels) != self.level_count:
            raise ValueError("The number of levels must match level_count.")
        if len({level.id for level in self.levels}) != len(self.levels):
            raise ValueError("Each level must have a unique id.")
        return self


class CameraConfigRequest(BaseModel):
    entry_lane_cameras: int = Field(ge=1, le=4)
    exit_lane_cameras: int = Field(ge=1, le=4)

    @model_validator(mode="after")
    def validate_combined_camera_limit(self):
        if self.entry_lane_cameras + self.exit_lane_cameras > 4:
            raise ValueError("Camera limit exceeded. A maximum of 4 cameras can be assigned across entry and exit lanes.")
        return self


class BillingConfigRequest(BaseModel):
    payments_enabled: bool
    cash_enabled: bool
    card_enabled: bool
    rate_per_minute: float = Field(gt=0)
    rate_unit: str = "minute"

    @model_validator(mode="after")
    def validate_payment_methods(self):
        if self.rate_unit not in {"minute", "hour", "day"}:
            raise ValueError("rate_unit must be minute, hour, or day.")
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

    # Save the admin configuration
    settings.garage_settings = request.model_dump()

    if settings.garage_settings.get("mode", "parking") == "parking":
        sync_parking_spaces(db, admin.tenant_id, settings.garage_settings["levels"])
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
    settings.camera_config = request.model_dump()
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
    settings.billing_config = request.model_dump()
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
        {"session_id": session.id, "plate": vehicles[session.vehicle_id].license_plate, "space": next((space.space_number for space in all_spaces if space.id == session.parking_space_id), None), "entry_time": session.entry_time, "duration_minutes": int((pakistan_now() - session.entry_time).total_seconds() // 60)}
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
    return {"live_sessions": live_sessions, "history": history, "space_status": {"total_active_capacity": len(spaces), "occupied": sum(space.is_occupied for space in spaces), "available": sum(not space.is_occupied for space in spaces), "spaces": [{"level": space.level, "space": space.space_number, "is_occupied": space.is_occupied, "plate": vehicles.get(active_by_space[space.id].vehicle_id).license_plate if space.id in active_by_space and active_by_space[space.id].vehicle_id in vehicles else None} for space in spaces]}, "vehicles": vehicle_rows, "billing_enabled": bool(settings["billing_config"].get("payments_enabled")), "garage_mode": settings["garage_settings"].get("mode", "parking")}


@router.post("/activity/{session_id}/remove")
def remove_active_parking(session_id: int, db: Session = Depends(get_db), admin=Depends(current_admin)):
    session = db.query(ParkingSession).filter(ParkingSession.id == session_id, ParkingSession.tenant_id == admin.tenant_id, ParkingSession.status == "active").first()
    if not session:
        raise HTTPException(status_code=404, detail="Active parking session not found.")
    space = db.query(ParkingSpace).filter(ParkingSpace.id == session.parking_space_id, ParkingSpace.tenant_id == admin.tenant_id).first()
    session.exit_time = pakistan_now()
    session.status = "removed"
    session.amount = 0
    session.payment_method = None
    if space:
        space.is_occupied = False
    db.commit()
    return {"success": True}


class VehiclePlateUpdateRequest(BaseModel):
    license_plate: str = Field(min_length=1, max_length=20)


@router.put("/activity/{session_id}/vehicle")
def update_active_vehicle(session_id: int, request: VehiclePlateUpdateRequest, db: Session = Depends(get_db), admin=Depends(current_admin)):
    session = db.query(ParkingSession).filter(ParkingSession.id == session_id, ParkingSession.tenant_id == admin.tenant_id, ParkingSession.status == "active").first()
    if not session:
        raise HTTPException(status_code=404, detail="Active parking session not found.")
    plate = request.license_plate.strip().upper()
    conflict = db.query(Vehicle).filter(Vehicle.tenant_id == admin.tenant_id, Vehicle.license_plate == plate, Vehicle.id != session.vehicle_id).first()
    if conflict:
        raise HTTPException(status_code=409, detail="That number plate already belongs to another vehicle.")
    vehicle = db.query(Vehicle).filter(Vehicle.id == session.vehicle_id).first()
    vehicle.license_plate = plate
    db.commit()
    return {"success": True, "plate": plate}


@router.get("/analytics")
def analytics(period: str = "7d", db: Session = Depends(get_db), admin=Depends(current_admin)):
    if period not in {"today", "7d", "30d", "90d"}:
        raise HTTPException(status_code=422, detail="period must be today, 7d, 30d, or 90d.")
    tenant_id = admin.tenant_id
    now = pakistan_now()
    today = now.date()
    backfill_completed_days(db, tenant_id)
    days = {"today": 1, "7d": 7, "30d": 30, "90d": 90}[period]
    start = today - timedelta(days=days - 1)
    historical = db.query(DailyParkingAnalytics).filter(
        DailyParkingAnalytics.tenant_id == tenant_id,
        DailyParkingAnalytics.analytics_date >= start,
        DailyParkingAnalytics.analytics_date < today,
    ).order_by(DailyParkingAnalytics.analytics_date).all()
    by_date = {item.analytics_date: {"date": item.analytics_date.isoformat(), "earnings": item.total_earnings, "vehicles": item.total_entries, "completed_sessions": item.completed_sessions, "average_duration_seconds": item.average_duration_seconds, "rush_hour_start": item.rush_hour_start, "peak_hour_vehicle_count": item.peak_hour_vehicle_count} for item in historical}
    if start <= today:
        by_date[today] = live_day_metrics(db, tenant_id, today)
    trend = []
    for offset in range(days):
        day = start + timedelta(days=offset)
        trend.append(by_date.get(day, {"date": day.isoformat(), "earnings": 0, "vehicles": 0, "completed_sessions": 0, "average_duration_seconds": 0, "rush_hour_start": None, "peak_hour_vehicle_count": 0}))
    earnings = sum(item["earnings"] for item in trend)
    completed_count = sum(item["completed_sessions"] for item in trend)
    average_seconds = sum(item["average_duration_seconds"] * item["completed_sessions"] for item in trend) / completed_count if completed_count else 0
    today_live = by_date[today]
    sessions = db.query(ParkingSession).filter(ParkingSession.tenant_id == tenant_id).all()
    graph_sessions = sessions if period == "today" else db.query(ParkingSession).filter(
        ParkingSession.tenant_id == tenant_id,
        ParkingSession.entry_time >= start,
    ).all()
    hourly = {hour: 0 for hour in range(24)}
    for item in graph_sessions:
        hourly[item.entry_time.hour] += 1
    rush_hour = max(hourly, key=hourly.get) if any(hourly.values()) else None
    spaces = db.query(ParkingSpace).filter(ParkingSpace.tenant_id == tenant_id, ParkingSpace.is_active.is_(True)).all()
    return {"period": period, "units": {"earnings": "PKR", "duration": "seconds", "traffic": "vehicles"}, "total_earnings": round(earnings, 2), "average_duration_minutes": round(average_seconds / 60, 1), "rush_hour": f"{rush_hour:02d}:00" if rush_hour is not None else None, "occupancy": {"occupied": sum(space.is_occupied for space in spaces), "total": len(spaces)}, "vehicles_today": today_live["vehicles"], "trend": trend, "hourly_activity": [{"hour": hour, "vehicles": count} for hour, count in hourly.items()]}
