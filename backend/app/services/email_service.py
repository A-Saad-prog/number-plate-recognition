import logging
import os
import smtplib
from email.message import EmailMessage

logger = logging.getLogger(__name__)


class EmailNotConfiguredError(RuntimeError):
    """Raised when SMTP settings are missing and no email can be sent."""


_SUBJECTS = {
    "email_verification": "Verify your Parking Garage admin email",
    "password_recovery": "Your Parking Garage password recovery code",
}

_REASONS = {
    "email_verification": "confirm this is your email address",
    "password_recovery": "recover access to your Parking Garage admin account",
}


def _smtp_config():
    host = os.getenv("SMTP_HOST")
    port = os.getenv("SMTP_PORT")
    username = os.getenv("SMTP_USERNAME")
    password = os.getenv("SMTP_PASSWORD")
    from_email = os.getenv("SMTP_FROM_EMAIL")

    if not host or not port or not username or not password or not from_email:
        return None

    try:
        port_int = int(port)
    except ValueError:
        return None

    return {
        "host": host,
        "port": port_int,
        "username": username,
        "password": password,
        "from_email": from_email,
        "use_tls": os.getenv("SMTP_USE_TLS", "true").strip().lower() not in {"0", "false", "no"},
    }


def send_security_code(recipient: str, code: str, purpose: str, expires_in_minutes: int = 10) -> None:
    """Email a one-time security code.

    Never logs the code unless AUTH_DEV_SHOW_OTP=true (development only).
    Raises EmailNotConfiguredError if SMTP isn't configured and the dev
    flag isn't set -- callers must not silently pretend the email sent.
    """

    dev_show_otp = os.getenv("AUTH_DEV_SHOW_OTP", "false").strip().lower() == "true"

    if dev_show_otp:
        logger.warning(
            "[AUTH_DEV_SHOW_OTP] %s code for %s: %s (expires in %sm). "
            "This flag must never be enabled in production.",
            purpose,
            recipient,
            code,
            expires_in_minutes,
        )

    config = _smtp_config()

    if not config:
        if dev_show_otp:
            return
        raise EmailNotConfiguredError(
            "SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USERNAME, "
            "SMTP_PASSWORD and SMTP_FROM_EMAIL to send security codes."
        )

    subject = _SUBJECTS.get(purpose, "Your Parking Garage security code")
    reason = _REASONS.get(purpose, "verify this request")

    body = (
        f"Your security code is: {code}\n\n"
        f"This code expires in {expires_in_minutes} minutes and is needed to {reason}.\n\n"
        "If you did not request this, you can safely ignore this email -- "
        "no changes will be made to your account."
    )

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = config["from_email"]
    message["To"] = recipient
    message.set_content(body)

    with smtplib.SMTP(config["host"], config["port"], timeout=10) as server:
        if config["use_tls"]:
            server.starttls()
        server.login(config["username"], config["password"])
        server.send_message(message)


def send_password_changed_notice(recipient: str, changed_at) -> None:
    """Best-effort security notice after a successful password reset.

    Must never block or roll back the password change on failure -- the
    caller is expected to catch and log, not re-raise.
    """

    config = _smtp_config()
    if not config:
        raise EmailNotConfiguredError("SMTP is not configured; cannot send security notice.")

    body = (
        "Your Parking Garage admin password was changed.\n\n"
        f"Time: {changed_at.isoformat(sep=' ', timespec='minutes')} (Asia/Karachi)\n\n"
        "If you did not make this change, contact your system administrator immediately."
    )

    message = EmailMessage()
    message["Subject"] = "Your Parking Garage admin password was changed"
    message["From"] = config["from_email"]
    message["To"] = recipient
    message.set_content(body)

    with smtplib.SMTP(config["host"], config["port"], timeout=10) as server:
        if config["use_tls"]:
            server.starttls()
        server.login(config["username"], config["password"])
        server.send_message(message)
