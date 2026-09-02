from app.database.database import Base, engine, SessionLocal

# Import all active models so SQLAlchemy knows about them
from app.models.vehicle import Vehicle
from app.models.parking_space import ParkingSpace
from app.models.parking_session import ParkingSession


def create_tables():
    Base.metadata.create_all(bind=engine)


if __name__ == "__main__":
    print("Creating database tables...")
    create_tables()

    print("Database initialization complete.")
