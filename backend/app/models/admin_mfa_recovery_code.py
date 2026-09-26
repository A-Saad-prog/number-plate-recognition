from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database.database import Base
from app.services.time_service import pakistan_now


class AdminMfaRecoveryCode(Base):
    __tablename__ = "admin_mfa_recovery_codes"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    admin_user_id: Mapped[int] = mapped_column(
        ForeignKey("admin_users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    code_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=pakistan_now, nullable=False)
