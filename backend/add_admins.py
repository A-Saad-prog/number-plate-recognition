import getpass
import os
from dotenv import load_dotenv

load_dotenv()

from pwdlib import PasswordHash
from app.database.database import SessionLocal
from app.models.admin_user import AdminUser

password_hash = PasswordHash.recommended()

print("=" * 60)
print("Add Admin Users to Database")
print("=" * 60)
print("Type 'exit' as username to stop\n")

count = 0

while True:
    username = input("Admin username (or 'exit' to stop): ").strip()
    
    if username.lower() == 'exit':
        break
    
    if not username:
        print("⚠️  Username cannot be empty. Try again.\n")
        continue
    
    with SessionLocal() as db:
        # Check if username already exists
        if db.query(AdminUser).filter(AdminUser.username == username).first():
            print(f"❌ Admin '{username}' already exists. Try a different username.\n")
            continue
        
        # Get password
        password = getpass.getpass("Password: ")
        
        if not password:
            print("⚠️  Password cannot be empty. Try again.\n")
            continue
        
        # Confirm password
        confirmation = getpass.getpass("Confirm password: ")
        
        if password != confirmation:
            print("❌ Passwords don't match. Try again.\n")
            continue
        
        # Add admin to database
        try:
            admin = AdminUser(
                username=username,
                password_hash=password_hash.hash(password)
            )
            db.add(admin)
            db.commit()
            print(f"✅ Admin '{username}' created successfully!\n")
            count += 1
        except Exception as e:
            print(f"❌ Error creating admin: {str(e)}\n")
            db.rollback()

print("=" * 60)
print(f"✓ Total admins added: {count}")
print("=" * 60)
