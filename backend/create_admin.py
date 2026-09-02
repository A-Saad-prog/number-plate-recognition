# Automatic deployment test
import getpass

from dotenv import load_dotenv

from app.database.database import SessionLocal
from app.models.admin_user import AdminUser
from app.models.tenant import Tenant
from app.services.auth_service import password_hash


load_dotenv()

username = input("Admin username: ").strip()
tenant_name = input("Tenant name: ").strip()
password = getpass.getpass("Admin password: ")
confirmation = getpass.getpass("Confirm password: ")

if not username or not password:
    raise SystemExit("Username and password are required.")
if password != confirmation:
    raise SystemExit("Passwords do not match.")

with SessionLocal() as db:
    if db.query(AdminUser).filter(AdminUser.username == username).first():
        raise SystemExit("That admin username already exists.")

    tenant = db.query(Tenant).filter(Tenant.name == tenant_name).first()
    if tenant is None:
        raise SystemExit("Tenant does not exist. Use create_tenant_admin.py first.")
    db.add(AdminUser(tenant_id=tenant.id, username=username, password_hash=password_hash.hash(password)))
    db.commit()

print(f"Admin user '{username}' created.")
