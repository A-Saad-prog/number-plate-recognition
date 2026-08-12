from app.database.database import Base, engine, SessionLocal

# Import all models so SQLAlchemy knows about them
from app.models.vehicle import Vehicle
from app.models.parking_space import ParkingSpace
from app.models.parking_session import ParkingSession
from app.models.qr_code import QRCode


def create_tables():
    Base.metadata.create_all(bind=engine)


def create_parking_spaces():
    db = SessionLocal()

    try:
        # Check if spaces already exist
        existing_spaces = db.query(ParkingSpace).count()

        if existing_spaces > 0:
            print(f"Parking spaces already exist: {existing_spaces}")
            return

        # Level 1: L1-01 to L1-20
        for number in range(1, 21):
            db.add(
                ParkingSpace(
                    level=1,
                    space_number=f"L1-{number:02d}",
                    is_occupied=False,
                )
            )

        # Level 2: L2-01 to L2-20
        for number in range(1, 21):
            db.add(
                ParkingSpace(
                    level=2,
                    space_number=f"L2-{number:02d}",
                    is_occupied=False,
                )
            )

        db.commit()

        print("Created 40 parking spaces.")

    finally:
        db.close()


if __name__ == "__main__":
    print("Creating database tables...")
    create_tables()

    print("Creating parking spaces...")
    create_parking_spaces()

    print("Database initialization complete.")