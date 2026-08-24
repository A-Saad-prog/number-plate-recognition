from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.services.auth_service import authenticate_admin, create_access_token, get_current_admin


router = APIRouter(prefix="/admin", tags=["admin"])
bearer_scheme = HTTPBearer(auto_error=False)


class AdminLoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=128)


@router.post("/login")
def admin_login(request: AdminLoginRequest, db: Session = Depends(get_db)):
    admin = authenticate_admin(db, request.username.strip(), request.password)
    if not admin:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return {"access_token": create_access_token(admin), "token_type": "bearer"}


@router.get("/me")
def admin_session(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    token = credentials.credentials if credentials else None
    admin = get_current_admin(token, db)
    return {"authenticated": True, "username": admin.username}
