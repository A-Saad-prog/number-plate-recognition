# Frontend App

This folder contains the React frontend for the parking garage system.

## Purpose

The frontend handles:

- live camera preview
- license plate detection display
- entry and exit vehicle actions
- parking slot status view
- payment selection and receipt generation
- admin navigation

## Tech Stack

- React 19
- Vite
- JavaScript
- CSS Modules / custom CSS

## Setup

```powershell
cd frontend
npm install
```

Create a `.env` file if you need a custom backend URL:

```env
VITE_API_BASE_URL=http://127.0.0.1:8000
```

## Run in Development Mode

```powershell
npm run dev
```

Then open:

- http://localhost:5173

## Production Build

```powershell
npm run build
```

Preview the build locally:

```powershell
npm run preview
```

## Main Features

- Entry camera stream
- Exit camera stream
- Automatic number plate detection
- Parking selection UI
- Vehicle confirmation flow
- Billing summary and exit receipt
- Parking status dashboard

## Notes

- The frontend relies on the backend running at `VITE_API_BASE_URL`.
- Camera access is necessary for live detection.
- The app expects the backend to respond with parking and detection data in the expected format.
