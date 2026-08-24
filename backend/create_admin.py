import getpass

from dotenv import load_dotenv

from app.database.database import SessionLocal
from app.models.admin_user import AdminUser
from app.services.auth_service import password_hash


load_dotenv()

username = input("Admin username: ").strip()
password = getpass.getpass("Admin password: ")
confirmation = getpass.getpass("Confirm password: ")

if not username or not password:
    raise SystemExit("Username and password are required.")
if password != confirmation:
    raise SystemExit("Passwords do not match.")

with SessionLocal() as db:
    if db.query(AdminUser).filter(AdminUser.username == username).first():
        raise SystemExit("That admin username already exists.")

    db.add(AdminUser(username=username, password_hash=password_hash.hash(password)))
    db.commit()

print(f"Admin user '{username}' created.")
