# Backend API

This folder contains the backend for the Parking Garage Number Plate Recognition System.

## Purpose

The backend is responsible for:

- exposing the FastAPI API
- processing number plate detection requests
- managing parking sessions
- handling vehicle entry and exit logic
- calculating fees
- authenticating admins and whitelist management

## Tech Stack

- Python 3.11+
- FastAPI
- SQLAlchemy
- PostgreSQL
- YOLO + OCR detection pipeline
- Alembic for database migrations

## Setup

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Create a `.env` file inside the backend folder:

```env
DATABASE_URL=postgresql://username:password@host:port/database_name
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
JWT_SECRET_KEY=your_secure_secret_key
```

## Database Setup

Initialize tables and parking spaces:

```powershell
python app/database/init_db.py
```

## Admin Setup

Create the first admin user:

```powershell
python create_admin.py
```

You will be prompted for:

- username
- password
- password confirmation

## Run the Backend

```powershell
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## API Documentation

Open the Swagger UI:

- http://localhost:8000/docs

Open the ReDoc UI:

- http://localhost:8000/redoc

## Main Endpoints

### Health

```http
GET /health
```

### Parking spaces

```http
GET /parking/spaces
```

### Vehicle entry

```http
POST /parking/entry
```

### Vehicle exit

```http
POST /parking/exit
```

### Vision detection

```http
POST /vision/detect-plate
```

### Admin

```http
POST /admin/login
GET /admin/me
GET /admin/whitelist
POST /admin/whitelist
DELETE /admin/whitelist
```

## Notes

- The computer vision model is loaded from `models/best.pt`.
- The backend expects a working SQL database connection.
- Use the `.env` file to supply internal credentials and CORS origin values.
- Camera input is processed through the license plate detection endpoint.
