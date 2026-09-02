from sqlalchemy import Boolean, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database.database import Base


class ParkingSpace(Base):
    __tablename__ = "parking_spaces"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), nullable=False, index=True)
    level: Mapped[int] = mapped_column(Integer, nullable=False)
    space_number: Mapped[str] = mapped_column(
        String(10),
        nullable=False,
    )
    is_occupied: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)

    __table_args__ = (UniqueConstraint("tenant_id", "level", "space_number", name="uq_parking_space_tenant_level_number"),)
