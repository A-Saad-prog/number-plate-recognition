import logging
import re

from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.admin_password_recovery import AdminPasswordRecovery
from app.models.admin_user import AdminUser
from app.services.auth_service import get_current_admin
from app.services.email_service import EmailNotConfiguredError, send_security_code
from app.services.recovery_service import (
    OTP_TTL_MINUTES,
    PURPOSE_EMAIL_VERIFICATION,
    CooldownActiveError,
    invalidate_all_for_admin,
    start_challenge,
    verify_email_otp,
)
from app.services.time_service import pakistan_now
from app.services.totp_service import (
    TotpEncryptionNotConfiguredError,
    build_provisioning_uri,
    encrypt_totp_secret,
    generate_totp_secret,
    verify_totp_code,
)
from app.services.mfa_recovery_service import generate_recovery_codes

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/security", tags=["admin-security"])
bearer_scheme = HTTPBearer(auto_error=False)


def current_admin(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    token = credentials.credentials if credentials else None
    return get_current_admin(token, db)


class EmailOtpVerifyRequest(BaseModel):
    code: str = Field(min_length=1, max_length=12)


class EmailAssignmentRequest(BaseModel):
    email: str = Field(min_length=3, max_length=255)


class TotpConfirmRequest(BaseModel):
    code: str = Field(min_length=1, max_length=12)


@router.get("/status")
def security_status(admin=Depends(current_admin)):
    return {
        "email": admin.email,
        "email_verified": bool(admin.email_verified),
        "totp_enabled": bool(admin.totp_enabled),
    }


@router.patch("/email")
def assign_admin_email(
    request: EmailAssignmentRequest,
    db: Session = Depends(get_db),
    admin=Depends(current_admin),
):
    email = request.email.strip().lower()
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(status_code=422, detail="Enter a valid email address.")

    owner = (
        db.query(AdminUser)
        .filter(func.lower(AdminUser.email) == email, AdminUser.id != admin.id)
        .first()
    )
    if owner:
        raise HTTPException(status_code=409, detail="That email is already in use.")

    if admin.email == email:
        return {
            "success": True,
            "email": admin.email,
            "email_verified": bool(admin.email_verified),
        }

    admin.email = email
    admin.email_verified = False
    invalidate_all_for_admin(db, admin.id, PURPOSE_EMAIL_VERIFICATION, commit=False)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="That email is already in use.") from None

    return {"success": True, "email": admin.email, "email_verified": False}


@router.post("/email/send-verification")
def send_email_verification(
    db: Session = Depends(get_db),
    admin=Depends(current_admin),
):
    if not admin.email:
        raise HTTPException(
            status_code=400,
            detail="Add an email to your admin account before verifying it.",
        )

    if admin.email_verified:
        return {"success": True, "message": "This email is already verified."}

    try:
        row, otp = start_challenge(db, admin.id, PURPOSE_EMAIL_VERIFICATION)
    except CooldownActiveError:
        return {
            "success": True,
            "message": "A verification code was already sent recently. Check your email.",
        }

    try:
        send_security_code(admin.email, otp, PURPOSE_EMAIL_VERIFICATION, OTP_TTL_MINUTES)
    except EmailNotConfiguredError as error:
        logger.error("Could not send admin email verification: %s", error)
        raise HTTPException(
            status_code=503,
            detail="Email delivery is not configured on this server yet.",
        ) from None

    return {
        "success": True,
        "message": "A verification code was sent to your email.",
    }


@router.post("/email/verify")
def verify_email(
    request: EmailOtpVerifyRequest,
    db: Session = Depends(get_db),
    admin=Depends(current_admin),
):
    invalid = HTTPException(status_code=400, detail="Invalid or expired verification code.")

    row = (
        db.query(AdminPasswordRecovery)
        .filter(
            AdminPasswordRecovery.admin_user_id == admin.id,
            AdminPasswordRecovery.purpose == PURPOSE_EMAIL_VERIFICATION,
            AdminPasswordRecovery.used_at.is_(None),
        )
        .order_by(AdminPasswordRecovery.created_at.desc())
        .first()
    )

    if not row:
        raise invalid

    if not verify_email_otp(db, row, request.code.strip()):
        raise invalid

    admin.email_verified = True
    row.used_at = pakistan_now()
    db.commit()

    return {"success": True}


@router.post("/totp/setup")
def setup_totp(
    db: Session = Depends(get_db),
    admin=Depends(current_admin),
):
    if admin.totp_enabled:
        raise HTTPException(status_code=400, detail="Authenticator is already enabled.")
    if not admin.email_verified:
        raise HTTPException(
            status_code=400,
            detail="Verify your email before setting up an authenticator.",
        )

    secret = generate_totp_secret()
    try:
        admin.totp_secret_encrypted = encrypt_totp_secret(secret)
    except TotpEncryptionNotConfiguredError as error:
        logger.error("TOTP setup failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail="Authenticator setup is not configured on this server yet.",
        ) from None

    # Stored but NOT enabled until /totp/confirm succeeds with a live code.
    db.commit()

    account_label = admin.email or admin.username
    return {
        "success": True,
        "secret": secret,
        "otpauth_url": build_provisioning_uri(secret, account_label),
    }


@router.post("/totp/confirm")
def confirm_totp(
    request: TotpConfirmRequest,
    db: Session = Depends(get_db),
    admin=Depends(current_admin),
):
    invalid = HTTPException(status_code=400, detail="Invalid or expired verification code.")

    if admin.totp_enabled:
        raise HTTPException(status_code=400, detail="Authenticator is already enabled.")

    if not admin.totp_secret_encrypted:
        raise HTTPException(
            status_code=400,
            detail="Start authenticator setup before confirming a code.",
        )

    try:
        code_is_valid = verify_totp_code(admin.totp_secret_encrypted, request.code.strip())
    except TotpEncryptionNotConfiguredError as error:
        logger.error("TOTP confirm failed: %s", error)
        raise HTTPException(
            status_code=503,
            detail="Authenticator setup is not configured on this server yet.",
        ) from None

    if not code_is_valid:
        raise invalid

    admin.totp_enabled = True
    recovery_codes = generate_recovery_codes(db, admin.id)
    db.commit()

    return {
        "success": True,
        "recovery_codes": recovery_codes,
        "recovery_codes_message": "Save these recovery codes somewhere safe. Each code can only be used once.",
    }
