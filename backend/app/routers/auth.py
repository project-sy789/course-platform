from __future__ import annotations

import datetime as dt
import hashlib
import secrets
from urllib.parse import urlencode

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from pydantic import BaseModel, EmailStr
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_session
from ..deps import current_user
from ..email import (
    render_password_reset_email,
    render_verification_email,
    send_email,
)
from ..logging import log
from ..models import EmailToken, User
from ..auth import create_jwt, hash_password, verify_password

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

VERIFY_TTL = dt.timedelta(hours=24)
RESET_TTL = dt.timedelta(minutes=30)


def _hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _issue_token(db: Session, user_id, purpose: str, ttl: dt.timedelta) -> str:
    raw = secrets.token_urlsafe(32)
    token = EmailToken(
        user_id=user_id,
        purpose=purpose,
        token_hash=_hash_token(raw),
        expires_at=dt.datetime.now(dt.timezone.utc) + ttl,
    )
    db.add(token)
    db.commit()
    return raw


def _consume_token(db: Session, raw: str, purpose: str) -> EmailToken | None:
    row = db.scalar(
        select(EmailToken).where(
            EmailToken.token_hash == _hash_token(raw),
            EmailToken.purpose == purpose,
            EmailToken.used_at.is_(None),
            EmailToken.expires_at > dt.datetime.now(dt.timezone.utc),
        )
    )
    if not row:
        return None
    row.used_at = dt.datetime.now(dt.timezone.utc)
    db.commit()
    return row


# ---------- Schemas ----------

class Credentials(BaseModel):
    email: EmailStr
    password: str


class EmailOnly(BaseModel):
    email: EmailStr


class TokenAndPassword(BaseModel):
    token: str
    new_password: str


# ---------- Endpoints ----------

@router.post("/register", status_code=201)
async def register(
    body: Credentials,
    bg: BackgroundTasks,
    db: Session = Depends(get_session),
):
    if db.scalar(select(User).where(User.email == body.email)):
        raise HTTPException(409, "email taken")
    if len(body.password) < 8:
        raise HTTPException(422, "password too short")
    user = User(email=body.email, password_hash=hash_password(body.password))
    db.add(user)
    db.commit()

    raw = _issue_token(db, user.id, "verify", VERIFY_TTL)
    verify_url = f"{settings.FRONTEND_URL}/verify-email?{urlencode({'token': raw})}"
    text, html = render_verification_email(verify_url)
    bg.add_task(send_email, body.email, "Verify your email", text, html)

    log.info("user_registered", target_user_id=str(user.id))
    return {"id": str(user.id), "email_verified": False}


@router.post("/resend-verification", status_code=202)
async def resend_verification(
    body: EmailOnly,
    bg: BackgroundTasks,
    db: Session = Depends(get_session),
):
    # Always 202 to prevent enumeration of who has an account.
    user = db.scalar(select(User).where(User.email == body.email))
    if user and not user.email_verified:
        raw = _issue_token(db, user.id, "verify", VERIFY_TTL)
        verify_url = f"{settings.FRONTEND_URL}/verify-email?{urlencode({'token': raw})}"
        text, html = render_verification_email(verify_url)
        bg.add_task(send_email, body.email, "Verify your email", text, html)
    return {"ok": True}


@router.post("/verify-email")
def verify_email(token: str, db: Session = Depends(get_session)):
    row = _consume_token(db, token, "verify")
    if not row:
        raise HTTPException(400, "invalid or expired token")
    db.execute(update(User).where(User.id == row.user_id).values(email_verified=True))
    db.commit()
    return {"ok": True}


@router.post("/login")
def login(body: Credentials, response: Response, db: Session = Depends(get_session)):
    user = db.scalar(select(User).where(User.email == body.email))
    if not user or not user.is_active or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "bad credentials")
    if not user.email_verified:
        raise HTTPException(403, "email not verified")
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


@router.post("/request-password-reset", status_code=202)
async def request_password_reset(
    body: EmailOnly,
    bg: BackgroundTasks,
    db: Session = Depends(get_session),
):
    # Always 202 to prevent enumeration.
    user = db.scalar(select(User).where(User.email == body.email))
    if user and user.is_active:
        raw = _issue_token(db, user.id, "reset", RESET_TTL)
        reset_url = f"{settings.FRONTEND_URL}/reset-password?{urlencode({'token': raw})}"
        text, html = render_password_reset_email(reset_url)
        bg.add_task(send_email, body.email, "Reset your password", text, html)
    return {"ok": True}


@router.post("/reset-password")
def reset_password(body: TokenAndPassword, db: Session = Depends(get_session)):
    if len(body.new_password) < 8:
        raise HTTPException(422, "password too short")
    row = _consume_token(db, body.token, "reset")
    if not row:
        raise HTTPException(400, "invalid or expired token")
    db.execute(
        update(User).where(User.id == row.user_id).values(
            password_hash=hash_password(body.new_password)
        )
    )
    db.commit()
    log.info("password_reset", target_user_id=str(row.user_id))
    return {"ok": True}


@router.get("/me")
def me(request_user: User = Depends(current_user)):
    return {
        "id": str(request_user.id),
        "email": request_user.email,
        "is_active": request_user.is_active,
        "is_admin": request_user.is_admin,
        "email_verified": request_user.email_verified,
    }
