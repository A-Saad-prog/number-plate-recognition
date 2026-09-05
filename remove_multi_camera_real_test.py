from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent
GARAGE = ROOT / "frontend" / "src" / "pages" / "GaragePage.jsx"
SERVICE = ROOT / "frontend" / "src" / "services" / "multiCameraVisionTestScheduler.js"
BACKUP = ROOT / "frontend" / "src" / "pages" / "GaragePage.jsx.multi-camera-test-backup"

if not BACKUP.exists():
    raise SystemExit("ERROR: Backup not found. Use git restore frontend/src/pages/GaragePage.jsx if needed.")

shutil.copy2(BACKUP, GARAGE)
BACKUP.unlink()

if SERVICE.exists():
    SERVICE.unlink()

print("REMOVED OK")
print("GaragePage.jsx restored and temporary scheduler deleted.")
