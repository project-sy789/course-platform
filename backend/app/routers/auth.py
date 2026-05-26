from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from sqlalchemy import select

from ..db import get_session
from ..models import User
from ..auth import hash_password, verify_password, create_jwt
from ..config import settings
from ..deps import current_user

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


class Credentials(BaseModel):
    email: EmailStr
    password: str


@router.post("/register", status_code=201)
def register(body: Credentials, db: Session = Depends(get_session)):
    if db.scalar(select(User).where(User.email == body.email)):
        raise HTTPException(409, "email taken")
    if len(body.password) < 8:
        raise HTTPException(422, "password too short")
    user = User(email=body.email, password_hash=hash_password(body.password))
    db.add(user)
    db.commit()
    return {"id": str(user.id)}


@router.post("/login")
def login(body: Credentials, response: Response, db: Session = Depends(get_session)):
    user = db.scalar(select(User).where(User.email == body.email))
    if not user or not user.is_active or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "bad credentials")
    token = create_jwt(str(user.id))
    response.set_cookie(
        "session", token,
        httponly=True, secure=True, samesite="strict",
        max_age=settings.JWT_TTL_MIN * 60, path="/",
    )
    return {"ok": True, "token": token}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie("session", path="/")
    return {"ok": True}


@router.get("/me")
def me(request_user: User = Depends(current_user)):
    return {
        "id": str(request_user.id),
        "email": request_user.email,
        "is_active": request_user.is_active,
    }
