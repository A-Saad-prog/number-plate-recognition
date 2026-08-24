Create a .env file in backend root with variable name DATABASE_URL=*your database url*.
Change camera name according to your hardware.

## Admin setup

The admin password is stored as an Argon2 password hash, not encrypted
reversible text. The JWT secret and database URL belong on the AWS backend.

Add these values to `backend/.env` on AWS:

```env
DATABASE_URL=your_neon_connection_string
JWT_SECRET_KEY=use_a_long_random_secret
CORS_ORIGINS=http://localhost:5173
```

Install the two backend dependencies and run the migration on AWS:

```powershell
python -m pip install "PyJWT==2.10.1" "pwdlib[argon2]==0.2.1"
alembic upgrade head
```

Seed the first admin interactively. The password is never printed or stored
in the script:

```powershell
python create_admin.py
```

Set the frontend API URL to the AWS API when starting Vite:

```powershell
$env:VITE_API_BASE_URL="https://your-api-domain"
npm run dev
```

Then open `http://localhost:5173/admin`. The login token is kept in
`sessionStorage`, expires after 30 minutes, and is required for protected
FastAPI calls.
