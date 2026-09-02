"""Create a tenant and its first customer admin without exposing infrastructure details."""
import argparse
import getpass

from app.database.database import SessionLocal
from app.models.admin_user import AdminUser
from app.models.tenant import Tenant
from app.services.auth_service import password_hash


parser = argparse.ArgumentParser()
parser.add_argument("tenant_name", nargs="?")
parser.add_argument("username", nargs="?")
args = parser.parse_args()
tenant_name = (args.tenant_name or input("Tenant name: ")).strip()
username = (args.username or input("Admin username: ")).strip()
password = getpass.getpass("Password: ")

if not tenant_name or not username or not password:
    raise SystemExit("Tenant name, admin username, and password are required.")

with SessionLocal() as db:
    if db.query(AdminUser).filter(AdminUser.username == username).first():
        raise SystemExit("Username already exists.")
    tenant = db.query(Tenant).filter(Tenant.name == tenant_name).first()
    if tenant is None:
        tenant = Tenant(name=tenant_name)
        db.add(tenant)
        db.flush()
    try:
        db.add(AdminUser(tenant_id=tenant.id, username=username, password_hash=password_hash.hash(password)))
        db.commit()
    except Exception:
        db.rollback()
        raise

print(f"Created admin '{username}' for '{tenant_name}'.")
