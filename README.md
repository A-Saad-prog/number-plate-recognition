# Parking Garage Number Plate Recognition System

A smart parking management system built for vehicle entry and exit tracking using camera-based number plate recognition, a FastAPI backend, and a React + Vite frontend.

## Features

- Automatic vehicle detection from live camera feed
- Number plate recognition with YOLO + OCR workflow
- Entry and exit processing for parking sessions
- Parking space assignment and occupancy tracking
- Payment calculation at Rs 1.67 per minute
- Admin login and whitelist management
- Real-time parking status dashboard
- Responsive UI for monitoring garage activity

## Tech Stack

### Frontend
- React 19
- Vite
- HTML/CSS/JavaScript
- Fetch API for backend communication

### Backend
- Python 3.11+
- FastAPI
- SQLAlchemy
- PostgreSQL / any SQLAlchemy-compatible database
- YOLO model inference
- PaddleOCR for plate reading

## Project Structure

```text
number-plate-recognition/
├── README.md
├── requirements.txt
├── backend/
│   ├── app/
│   ├── alembic/
│   ├── alembic.ini
│   ├── create_admin.py
│   ├── requirements.txt
│   └── .env
├── frontend/
│   ├── src/
│   ├── public/
│   ├── package.json
│   ├── vite.config.js
│   └── .env
├── models/
│   └── best.pt
└── src/
    ├── train.py
    └── plate_tracker.py
```

## Prerequisites

Before running the project, install:

- Python 3.11+
- Node.js 18+
- npm
- PostgreSQL database (or another supported SQLAlchemy database)
- Camera access enabled on the machine running the frontend

## 1. Backend Setup

Open a terminal in the project root and run:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Create a `.env` file inside `backend/`:

```env
DATABASE_URL=postgresql://username:password@host:port/database_name
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
JWT_SECRET_KEY=your_super_secret_key_here
```

Initialize the database tables and create the parking spaces:

```powershell
python app/database/init_db.py
```

Create an admin user:

```powershell
python create_admin.py
```

Follow the prompts to enter a username and password.

Run the API:

```powershell
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API docs will be available at:

- http://localhost:8000/docs
- http://localhost:8000/redoc

## 2. Frontend Setup

Open a second terminal and run:

```powershell
cd frontend
npm install
```

Create a `.env` file inside `frontend/` if needed:

```env
VITE_API_BASE_URL=http://127.0.0.1:8000
```

Start the app:

```powershell
npm run dev
```

The frontend should open on:

- http://localhost:5173

## 3. Production Build

For frontend production build:

```powershell
cd frontend
npm run build
```

To preview the production build locally:

```powershell
npm run preview
```

## 4. Admin Panel

After starting the backend and frontend, open:

- http://localhost:5173/admin

Login with the admin account created using `create_admin.py`.

Admin features include:

- viewing whitelist entries
- adding allowed vehicles
- removing whitelist entries

## 5. Parking Logic

The system works like this:

1. Vehicle enters the camera view
2. Backend recognizes the plate using YOLO + OCR
3. Frontend identifies the detected vehicle
4. User chooses entry or exit action
5. Backend verifies the parking session
6. Pricing is calculated using Rs 1.67 per minute
7. Parking status updates in real time

## 6. Notes

- The model file is stored under `models/best.pt`.
- Camera permissions are required for live vehicle detection.
- The frontend must be able to reach the backend on the configured API URL.
- If the camera does not detect plates properly, check lighting, camera quality, and model accuracy.

## 7. Troubleshooting

### Backend fails to start
- Check that `DATABASE_URL` is correctly set
- Confirm all Python dependencies were installed
- Ensure the database is reachable

### Frontend cannot reach backend
- Confirm `VITE_API_BASE_URL` matches the backend host and port
- Check CORS configuration in the backend

### No plates detected
- Verify camera access is allowed
- Check the model file exists at `models/best.pt`
- Make sure the backend is running before using the camera flow

## License

This project is intended for educational and project/demo use. Please ensure compliance with your local licensing and usage requirements for camera, OCR, and ML model dependencies.
