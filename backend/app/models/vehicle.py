from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.database import Base
from app.services.time_service import pakistan_now


class Vehicle(Base):
    __tablename__ = "vehicles"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, index=True)
    license_plate: Mapped[str] = mapped_column(
        String(20),
        index=True,
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=pakistan_now,
        nullable=False,
    )

    __table_args__ = (UniqueConstraint("tenant_id", "license_plate", name="uq_vehicle_tenant_plate"),)
