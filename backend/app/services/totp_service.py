import os

import pyotp
from cryptography.fernet import Fernet, InvalidToken

ISSUER = "Parking Garage Admin"


class TotpEncryptionNotConfiguredError(RuntimeError):
    """Raised when TOTP_ENCRYPTION_KEY is missing or invalid."""


def _fernet() -> Fernet:
    key = os.getenv("TOTP_ENCRYPTION_KEY")
    if not key:
        raise TotpEncryptionNotConfiguredError(
            "TOTP_ENCRYPTION_KEY is not set; cannot encrypt/decrypt authenticator secrets."
        )
    try:
        return Fernet(key.encode())
    except (ValueError, TypeError) as error:
        raise TotpEncryptionNotConfiguredError(
            "TOTP_ENCRYPTION_KEY is not a valid Fernet key."
        ) from error


def generate_totp_secret() -> str:
    return pyotp.random_base32()


def encrypt_totp_secret(secret: str) -> str:
    return _fernet().encrypt(secret.encode()).decode()


def decrypt_totp_secret(encrypted_secret: str) -> str:
    try:
        return _fernet().decrypt(encrypted_secret.encode()).decode()
    except InvalidToken as error:
        raise TotpEncryptionNotConfiguredError(
            "Stored TOTP secret could not be decrypted; TOTP_ENCRYPTION_KEY may be wrong."
        ) from error


def build_provisioning_uri(secret: str, account_name: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=account_name, issuer_name=ISSUER)


def verify_totp_code(encrypted_secret: str, code: str) -> bool:
    secret = decrypt_totp_secret(encrypted_secret)
    return pyotp.TOTP(secret).verify(code, valid_window=1)
