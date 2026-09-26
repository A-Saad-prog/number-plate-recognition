import hashlib
import hmac
import os
import secrets

from sqlalchemy.orm import Session

from app.models.admin_mfa_recovery_code import AdminMfaRecoveryCode
from app.services.time_service import pakistan_now

RECOVERY_CODE_COUNT = 10
_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _pepper() -> bytes:
    value = os.getenv("AUTH_RECOVERY_PEPPER")
    if not value:
        raise RuntimeError("AUTH_RECOVERY_PEPPER is not set")
    return value.encode()


def normalize_recovery_code(code: str) -> str:
    return "".join(code.split()).replace("-", "").upper()


def recovery_code_hash(code: str) -> str:
    return hmac.new(_pepper(), normalize_recovery_code(code).encode(), hashlib.sha256).hexdigest()


def generate_recovery_codes(db: Session, admin_id: int) -> list[str]:
    codes = [
        "-".join("".join(secrets.choice(_ALPHABET) for _ in range(4)) for _ in range(3))
        for _ in range(RECOVERY_CODE_COUNT)
    ]
    for code in codes:
        db.add(AdminMfaRecoveryCode(admin_user_id=admin_id, code_hash=recovery_code_hash(code)))
    return codes


def invalidate_recovery_codes(db: Session, admin_id: int) -> None:
    db.query(AdminMfaRecoveryCode).filter(
        AdminMfaRecoveryCode.admin_user_id == admin_id,
        AdminMfaRecoveryCode.used_at.is_(None),
    ).update({AdminMfaRecoveryCode.used_at: pakistan_now()}, synchronize_session=False)


def consume_recovery_code(db: Session, admin_id: int, code: str) -> bool:
    digest = recovery_code_hash(code)
    row = (
        db.query(AdminMfaRecoveryCode)
        .filter(
            AdminMfaRecoveryCode.admin_user_id == admin_id,
            AdminMfaRecoveryCode.code_hash == digest,
            AdminMfaRecoveryCode.used_at.is_(None),
        )
        .with_for_update()
        .first()
    )
    if not row:
        return False
    row.used_at = pakistan_now()
    return True
