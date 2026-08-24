from datetime import datetime

from sqlalchemy import DateTime, Float, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database.database import Base
from app.services.time_service import pakistan_now


class WhitelistEntry(Base):
    __tablename__ = "whitelist_entries"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    license_plate: Mapped[str] = mapped_column(String(20), unique=True, index=True, nullable=False)
    vehicle_name: Mapped[str] = mapped_column(String(100), nullable=False)
    discount_percent: Mapped[float] = mapped_column(Float, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=pakistan_now, nullable=False)