from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.database import Base
from app.services.time_service import pakistan_now


class DailyParkingAnalytics(Base):
    __tablename__ = "daily_parking_analytics"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, index=True)
    analytics_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    total_earnings: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    total_entries: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed_sessions: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    average_duration_seconds: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    rush_hour_start: Mapped[int | None] = mapped_column(Integer, nullable=True)
    peak_hour_vehicle_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=pakistan_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=pakistan_now, onupdate=pakistan_now, nullable=False)

    __table_args__ = (UniqueConstraint("tenant_id", "analytics_date", name="uq_daily_analytics_tenant_date"),)
