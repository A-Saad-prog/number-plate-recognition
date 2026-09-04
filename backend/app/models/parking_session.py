from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database.database import Base


class ParkingSession(Base):
    __tablename__ = "parking_sessions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, index=True)

    vehicle_id: Mapped[int] = mapped_column(
        ForeignKey("vehicles.id"),
        nullable=False,
    )

    parking_space_id: Mapped[int | None] = mapped_column(
        ForeignKey("parking_spaces.id"),
        nullable=True,
    )

    entry_time: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
    )

    exit_time: Mapped[datetime | None] = mapped_column(
        DateTime,
        nullable=True,
    )

    amount: Mapped[float | None] = mapped_column(
        Float,
        nullable=True,
    )

    payment_method: Mapped[str | None] = mapped_column(
        String(10),
        nullable=True,
    )

    status: Mapped[str] = mapped_column(
        String(20),
        default="active",
        nullable=False,
    )

    discount_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
