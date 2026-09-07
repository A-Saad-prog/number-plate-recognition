import hashlib
import hmac
import os
import secrets
from datetime import timedelta

from sqlalchemy.orm import Session

from app.models.admin_password_recovery import AdminPasswordRecovery
from app.services.time_service import pakistan_now

OTP_LENGTH = 6
OTP_TTL_MINUTES = 10
RESET_TOKEN_TTL_MINUTES = 10
MAX_OTP_ATTEMPTS = 5
MAX_TOTP_ATTEMPTS = 5
RESEND_COOLDOWN_SECONDS = 60

PURPOSE_EMAIL_VERIFICATION = "email_verification"
PURPOSE_PASSWORD_RECOVERY = "password_recovery"


class RecoveryConfigError(RuntimeError):
    """Raised when AUTH_RECOVERY_PEPPER is not configured."""


class CooldownActiveError(RuntimeError):
    """Raised when a resend is requested before the cooldown window elapses."""


def _pepper() -> str:
    pepper = os.getenv("AUTH_RECOVERY_PEPPER")
    if not pepper:
        raise RecoveryConfigError("AUTH_RECOVERY_PEPPER is not set.")
    return pepper


def _generate_otp() -> str:
    return "".join(str(secrets.randbelow(10)) for _ in range(OTP_LENGTH))


def _otp_digest(challenge_token: str, otp: str) -> str:
    # HMAC (not a plain hash) so a leaked DB can't be brute-forced offline
    # against the low-entropy 6-digit space without also knowing the pepper.
    return hmac.new(
        _pepper().encode(),
        f"{challenge_token}:{otp}".encode(),
        hashlib.sha256,
    ).hexdigest()


def _token_digest(token: str) -> str:
    # The reset token itself has ~256 bits of entropy, so a plain SHA-256
    # digest (no pepper needed) is an accepted, simple choice here.
    return hashlib.sha256(token.encode()).hexdigest()


def start_challenge(db: Session, admin_id: int, purpose: str) -> tuple[AdminPasswordRecovery, str]:
    """Invalidate any active challenge for this admin/purpose and start a new one.

    Returns the new row and the RAW one-time code so the caller can email
    it -- the code itself is never persisted in plain form.
    """
    now = pakistan_now()

    active = (
        db.query(AdminPasswordRecovery)
        .filter(
            AdminPasswordRecovery.admin_user_id == admin_id,
            AdminPasswordRecovery.purpose == purpose,
            AdminPasswordRecovery.used_at.is_(None),
        )
        .order_by(AdminPasswordRecovery.created_at.desc())
        .first()
    )

    if active and (now - active.created_at) < timedelta(seconds=RESEND_COOLDOWN_SECONDS):
        raise CooldownActiveError()

    # Only one active challenge per admin/purpose at a time.
    db.query(AdminPasswordRecovery).filter(
        AdminPasswordRecovery.admin_user_id == admin_id,
        AdminPasswordRecovery.purpose == purpose,
        AdminPasswordRecovery.used_at.is_(None),
    ).update({AdminPasswordRecovery.used_at: now})

    challenge_token = secrets.token_urlsafe(24)
    otp = _generate_otp()

    row = AdminPasswordRecovery(
        admin_user_id=admin_id,
        purpose=purpose,
        challenge_token=challenge_token,
        otp_digest=_otp_digest(challenge_token, otp),
        expires_at=now + timedelta(minutes=OTP_TTL_MINUTES),
        attempt_count=0,
        created_at=now,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row, otp


def get_active_challenge(db: Session, challenge_token: str, purpose: str) -> AdminPasswordRecovery | None:
    return (
        db.query(AdminPasswordRecovery)
        .filter(
            AdminPasswordRecovery.challenge_token == challenge_token,
            AdminPasswordRecovery.purpose == purpose,
            AdminPasswordRecovery.used_at.is_(None),
        )
        .first()
    )


def get_active_challenge_for_admin(db: Session, admin_id: int, purpose: str) -> AdminPasswordRecovery | None:
    return (
        db.query(AdminPasswordRecovery)
        .filter(
            AdminPasswordRecovery.admin_user_id == admin_id,
            AdminPasswordRecovery.purpose == purpose,
            AdminPasswordRecovery.used_at.is_(None),
        )
        .order_by(AdminPasswordRecovery.created_at.desc())
        .first()
    )


def verify_email_otp(db: Session, row: AdminPasswordRecovery, otp: str) -> bool:
    """Check the email OTP for `row`. Marks the email step verified on success.

    Always commits (attempt tracking must persist even on failure) and
    returns False for any invalid state (expired/exhausted/wrong code)
    rather than raising, so callers can use one generic error message.
    """
    now = pakistan_now()

    if row.used_at is not None or row.otp_digest is None:
        return False
    if now > row.expires_at:
        return False
    if row.attempt_count >= MAX_OTP_ATTEMPTS:
        return False

    row.attempt_count += 1
    expected = _otp_digest(row.challenge_token, otp)
    is_valid = hmac.compare_digest(expected, row.otp_digest)

    if is_valid:
        row.verified_at = now
        row.otp_digest = None  # consumed; cannot be replayed
        row.attempt_count = 0  # fresh budget for the next step (TOTP)

    db.commit()
    return is_valid


def verify_totp_step(db: Session, row: AdminPasswordRecovery, code_is_valid: bool) -> bool:
    """Record a TOTP attempt against `row`. `code_is_valid` is computed by
    the caller (via totp_service) so this module doesn't need the admin's
    decrypted secret. Enforces expiry/attempt limits/step ordering.
    """
    now = pakistan_now()

    if row.used_at is not None or row.verified_at is None:
        return False
    if row.reset_token_digest is not None:
        return False  # already completed
    if now > row.expires_at:
        return False
    if row.attempt_count >= MAX_TOTP_ATTEMPTS:
        return False

    row.attempt_count += 1
    if code_is_valid:
        row.attempt_count = 0

    db.commit()
    return code_is_valid


def issue_reset_token(db: Session, row: AdminPasswordRecovery) -> str:
    now = pakistan_now()
    reset_token = secrets.token_urlsafe(32)
    row.reset_token_digest = _token_digest(reset_token)
    row.expires_at = now + timedelta(minutes=RESET_TOKEN_TTL_MINUTES)
    db.commit()
    return reset_token


def find_reset_challenge(db: Session, reset_token: str) -> AdminPasswordRecovery | None:
    digest = _token_digest(reset_token)
    return (
        db.query(AdminPasswordRecovery)
        .filter(
            AdminPasswordRecovery.purpose == PURPOSE_PASSWORD_RECOVERY,
            AdminPasswordRecovery.reset_token_digest == digest,
        )
        .first()
    )


def is_reset_challenge_valid(row: AdminPasswordRecovery) -> bool:
    now = pakistan_now()
    return (
        row.used_at is None
        and row.verified_at is not None
        and row.reset_token_digest is not None
        and now <= row.expires_at
    )


def consume_reset_challenge(db: Session, row: AdminPasswordRecovery) -> None:
    """Marks the row used. Does not commit -- callers fold this into the
    single atomic transaction that also updates the admin's password."""
    row.used_at = pakistan_now()


def invalidate_all_for_admin(
    db: Session, admin_id: int, purpose: str | None = None, *, commit: bool = True
) -> None:
    now = pakistan_now()
    query = db.query(AdminPasswordRecovery).filter(
        AdminPasswordRecovery.admin_user_id == admin_id,
        AdminPasswordRecovery.used_at.is_(None),
    )
    if purpose:
        query = query.filter(AdminPasswordRecovery.purpose == purpose)
    query.update({AdminPasswordRecovery.used_at: now})
    if commit:
        db.commit()
