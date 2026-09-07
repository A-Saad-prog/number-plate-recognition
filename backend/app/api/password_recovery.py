import logging
import secrets

from fastapi import APIRouter, Depends, HTTPException
from pwdlib import PasswordHash
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.admin_user import AdminUser
from app.services.auth_service import find_admin_by_identifier
from app.services.email_service import EmailNotConfiguredError, send_security_code, send_password_changed_notice
from app.services.recovery_service import (
    OTP_TTL_MINUTES,
    PURPOSE_PASSWORD_RECOVERY,
    CooldownActiveError,
    RecoveryConfigError,
    consume_reset_challenge,
    find_reset_challenge,
    get_active_challenge,
    get_active_challenge_for_admin,
    invalidate_all_for_admin,
    is_reset_challenge_valid,
    issue_reset_token,
    start_challenge,
    verify_email_otp,
    verify_totp_step,
)
from app.services.time_service import pakistan_now
from app.services.totp_service import TotpEncryptionNotConfiguredError, verify_totp_code

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/password-recovery", tags=["password-recovery"])

password_hash = PasswordHash.recommended()

GENERIC_REQUEST_RESPONSE = {
    "success": True,
    "message": "If the account is eligible for recovery, a verification code has been sent.",
}

INVALID_CODE = HTTPException(status_code=400, detail="Invalid or expired verification code.")
INVALID_RESET = HTTPException(status_code=400, detail="This reset link is invalid or has expired.")


class PasswordRecoveryRequest(BaseModel):
    identifier: str = Field(min_length=1, max_length=255)


class PasswordRecoveryOtpRequest(BaseModel):
    challenge_token: str = Field(min_length=1, max_length=128)
    code: str = Field(min_length=1, max_length=12)


class PasswordRecoveryResetRequest(BaseModel):
    reset_token: str = Field(min_length=1, max_length=256)
    new_password: str = Field(min_length=12, max_length=128)


@router.post("/request")
def request_password_recovery(request: PasswordRecoveryRequest, db: Session = Depends(get_db)):
    # Whatever happens below, the response body is always the same shape --
    # knowing a username/email must never be enough to learn whether an
    # account, email, or MFA setup exists.
    identifier = request.identifier.strip()
    admin = find_admin_by_identifier(db, identifier) if identifier else None

    eligible = bool(
        admin and admin.email and admin.email_verified and admin.totp_enabled
    )

    challenge_token = None

    if eligible:
        try:
            row, otp = start_challenge(db, admin.id, PURPOSE_PASSWORD_RECOVERY)
            challenge_token = row.challenge_token
            send_security_code(admin.email, otp, PURPOSE_PASSWORD_RECOVERY, OTP_TTL_MINUTES)
        except CooldownActiveError:
            # A legitimate user re-submitting quickly (e.g. double-click)
            # should land on the same in-progress challenge, not a dead one.
            active = get_active_challenge_for_admin(db, admin.id, PURPOSE_PASSWORD_RECOVERY)
            challenge_token = active.challenge_token if active else None
        except (RecoveryConfigError, EmailNotConfiguredError) as error:
            logger.error("Password recovery could not be started: %s", error)
        except Exception:
            logger.exception("Unexpected error starting password recovery")

    if not challenge_token:
        # Keep the response shape identical whether the account is real,
        # ineligible, or a resend cooldown is active -- a fabricated token
        # simply never matches a row, so later steps fail the same generic
        # way as any other invalid code.
        challenge_token = secrets.token_urlsafe(24)

    return {**GENERIC_REQUEST_RESPONSE, "challenge_token": challenge_token}


@router.post("/verify-email")
def verify_recovery_email(request: PasswordRecoveryOtpRequest, db: Session = Depends(get_db)):
    row = get_active_challenge(db, request.challenge_token, PURPOSE_PASSWORD_RECOVERY)
    if not row:
        raise INVALID_CODE

    if not verify_email_otp(db, row, request.code.strip()):
        raise INVALID_CODE

    return {"success": True}


@router.post("/verify-totp")
def verify_recovery_totp(request: PasswordRecoveryOtpRequest, db: Session = Depends(get_db)):
    row = get_active_challenge(db, request.challenge_token, PURPOSE_PASSWORD_RECOVERY)
    if not row or row.verified_at is None:
        raise INVALID_CODE

    admin = db.get(AdminUser, row.admin_user_id)
    if not admin or not admin.totp_enabled or not admin.totp_secret_encrypted:
        raise INVALID_CODE

    try:
        code_is_valid = verify_totp_code(admin.totp_secret_encrypted, request.code.strip())
    except TotpEncryptionNotConfiguredError as error:
        logger.error("Recovery TOTP verification failed: %s", error)
        raise INVALID_CODE from None

    if not verify_totp_step(db, row, code_is_valid):
        raise INVALID_CODE

    reset_token = issue_reset_token(db, row)
    return {"success": True, "reset_token": reset_token}


@router.post("/reset")
def reset_admin_password(request: PasswordRecoveryResetRequest, db: Session = Depends(get_db)):
    row = find_reset_challenge(db, request.reset_token)
    if not row or not is_reset_challenge_valid(row):
        raise INVALID_RESET

    admin = db.get(AdminUser, row.admin_user_id)
    if not admin:
        raise INVALID_RESET

    admin.password_hash = password_hash.hash(request.new_password)
    admin.session_version += 1
    consume_reset_challenge(db, row)
    invalidate_all_for_admin(db, admin.id, PURPOSE_PASSWORD_RECOVERY, commit=False)

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise

    if admin.email:
        try:
            send_password_changed_notice(admin.email, pakistan_now())
        except Exception:
            logger.warning("Could not send password-changed notice to admin %s", admin.id)

    return {"success": True}
