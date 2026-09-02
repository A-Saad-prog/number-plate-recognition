from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.database import Base
from app.services.time_service import pakistan_now


class AdminSettings(Base):
    """Per-tenant settings managed by customer admins."""

    __tablename__ = "admin_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, unique=True, index=True)
    garage_settings: Mapped[dict] = mapped_column(JSON, nullable=False)
    camera_config: Mapped[dict] = mapped_column(JSON, nullable=False)
    billing_config: Mapped[dict] = mapped_column(JSON, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=pakistan_now,
        onupdate=pakistan_now,
        nullable=False,
    )
