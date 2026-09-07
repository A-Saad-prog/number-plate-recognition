from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database.database import Base
from app.services.time_service import pakistan_now


class AdminPasswordRecovery(Base):
    """One row per email-verification or password-recovery challenge.

    `purpose` distinguishes a logged-in admin verifying their own email
    (email_verification) from the public forgot-password flow
    (password_recovery). For password_recovery the same row carries the
    flow forward across steps: `verified_at` marks the email-OTP step as
    passed, and `reset_token_digest` is only populated once the TOTP
    step also passes -- its presence is what makes the reset step valid.
    """

    __tablename__ = "admin_password_recovery"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    admin_user_id: Mapped[int] = mapped_column(ForeignKey("admin_users.id"), nullable=False, index=True)
    purpose: Mapped[str] = mapped_column(String(30), nullable=False)
    challenge_token: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    otp_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)
    reset_token_digest: Mapped[str | None] = mapped_column(String(64), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=pakistan_now, nullable=False)
