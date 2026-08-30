from datetime import datetime

from sqlalchemy import DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.database.database import Base
from app.services.time_service import pakistan_now


class AdminSettings(Base):
    """Singleton record for the system-wide settings managed by an admin."""

    __tablename__ = "admin_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    garage_settings: Mapped[dict] = mapped_column(JSON, nullable=False)
    camera_config: Mapped[dict] = mapped_column(JSON, nullable=False)
    billing_config: Mapped[dict] = mapped_column(JSON, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=pakistan_now,
        onupdate=pakistan_now,
        nullable=False,
    )
