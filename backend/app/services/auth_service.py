import os
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import HTTPException, status
from pwdlib import PasswordHash
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.models.admin_user import AdminUser
from app.models.tenant import Tenant


password_hash = PasswordHash.recommended()
ADMIN_SESSION_MINUTES = max(5, int(os.getenv("ADMIN_SESSION_MINUTES", "480")))


def find_admin_by_identifier(db: Session, identifier: str) -> AdminUser | None:
    return (
        db.query(AdminUser)
        .filter(
            or_(
                AdminUser.username == identifier,
                func.lower(AdminUser.email) == identifier.lower(),
            )
        )
        .first()
    )


def authenticate_admin(db: Session, identifier: str, password: str) -> AdminUser | None:
    admin = find_admin_by_identifier(db, identifier)
    if not admin or not password_hash.verify(password, admin.password_hash):
        return None
    return admin


def create_access_token(admin: AdminUser) -> str:
    secret = os.getenv("JWT_SECRET_KEY")
    if not secret:
        raise RuntimeError("JWT_SECRET_KEY is not set")

    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(admin.id),
        "username": admin.username,
        "sv": admin.session_version,
        "iat": now,
        "exp": now + timedelta(minutes=ADMIN_SESSION_MINUTES),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def get_current_admin(token: str | None, db: Session) -> AdminUser:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    secret = os.getenv("JWT_SECRET_KEY")
    if not secret or not token:
        raise unauthorized

    try:
        payload = jwt.decode(token, secret, algorithms=["HS256"])
        admin_id = int(payload["sub"])
    except (jwt.InvalidTokenError, KeyError, TypeError, ValueError):
        raise unauthorized from None

    admin = db.get(AdminUser, admin_id)
    tenant = db.get(Tenant, admin.tenant_id) if admin else None
    if not admin or not tenant or not tenant.is_active:
        raise unauthorized
    # A password reset bumps session_version to invalidate every token
    # issued before it. Tokens minted before this field existed have no
    # "sv" claim at all, which never equals a real version -- treated as
    # unauthorized, so those admins simply sign in again once.
    if payload.get("sv") != admin.session_version:
        raise unauthorized
    return admin
