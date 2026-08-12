from sqlalchemy import Boolean, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database.database import Base


class ParkingSpace(Base):
    __tablename__ = "parking_spaces"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
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