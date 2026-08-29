import os
from dotenv import load_dotenv
from pwdlib import PasswordHash
from app.database.database import SessionLocal
from app.models.admin_user import AdminUser

load_dotenv()

ADMIN_SETUP_KEY = os.getenv("ADMIN_SETUP_KEY")
password_hash = PasswordHash.recommended()

print("=" * 60)
print("One-Time Admin Setup")
print("=" * 60)

# Verify setup key
setup_key = input("Enter setup key: ").strip()
if setup_key != ADMIN_SETUP_KEY:
    print("❌ Invalid setup key. Access denied.")
    exit(1)

print("✓ Setup key verified\n")

# Get admin credentials
username = input("Admin username: ").strip()
password = input("Password: ").strip()

if not username or not password:
    print("❌ Username and password cannot be empty.")
    exit(1)

# Add to database
db = SessionLocal()
try:
    # Check if username exists
    if db.query(AdminUser).filter(AdminUser.username == username).first():
        print(f"❌ Username '{username}' already exists.")
        exit(1)
    
    # Hash and create admin
    hashed = password_hash.hash(password)
    admin = AdminUser(username=username, password_hash=hashed)
    db.add(admin)
    db.commit()
    print(f"✓ Admin '{username}' created successfully!")
    
except Exception as e:
    db.rollback()
    print(f"❌ Error: {e}")
    exit(1)
finally:
    db.close()
