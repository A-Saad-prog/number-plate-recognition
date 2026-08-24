from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.whitelist_entry import WhitelistEntry
from app.services.auth_service import authenticate_admin, create_access_token, get_current_admin


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

    existing = db.query(WhitelistEntry).filter(WhitelistEntry.license_plate == license_plate).first()
    if existing:
        raise HTTPException(status_code=409, detail="This number plate is already whitelisted.")

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
        raise HTTPException(status_code=404, detail="No whitelisted vehicle matched that name or plate.")

    db.delete(entry)
    db.commit()
    return {"success": True, "removed": search}
