from __future__ import annotations

import datetime as dt
import hashlib
import json
import secrets
from urllib.parse import urlencode

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr
from redis.asyncio import Redis
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_redis, get_session
from ..deps import current_user
from ..antisharing import (
    check_impossible_travel, consume_otp_challenge, generate_otp_code,
    hash_device_id, is_trusted_device, log_login_event,
    record_successful_login, stash_otp_challenge, trust_device,
)
from ..email import (
    render_device_otp_email,
    render_password_reset_email,
    render_verification_email,
    send_email,
)
from ..logging import log
from ..models import EmailToken, User
from ..auth import create_jwt, decode_jwt, hash_password, jwt_remaining_seconds, verify_password

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
async def login(
    body: Credentials,
    request: Request,
    response: Response,
    bg: BackgroundTasks,
    db: Session = Depends(get_session),
    redis: Redis = Depends(get_redis),
):
    user = db.scalar(select(User).where(User.email == body.email))
    ip = _client_ip(request)
    ua = request.headers.get("user-agent", "")
    raw_device_id = request.headers.get("x-device-id", "")
    device_hash = hash_device_id(raw_device_id) if raw_device_id else None

    if not user or not user.is_active or not verify_password(body.password, user.password_hash):
        log_login_event(db, user=user, email=body.email, ip=ip, ua=ua,
                        device_hash=device_hash, status="bad_pw")
        db.commit()
        raise HTTPException(401, "bad credentials")
    if not user.email_verified:
        log_login_event(db, user=user, email=body.email, ip=ip, ua=ua,
                        device_hash=device_hash, status="unverified")
        db.commit()
        raise HTTPException(403, "email not verified")

    # Decide whether to short-circuit to OTP.
    require_otp = False
    suspicion_reason = None
    if settings.ANTI_SHARING_ENABLED:
        # No fingerprint header at all → treat as new device.
        if device_hash is None:
            require_otp = True
            suspicion_reason = "no device fingerprint"
        elif not is_trusted_device(db, user.id, device_hash):
            require_otp = True
            suspicion_reason = "new device"
        else:
            travel = await check_impossible_travel(redis, user.id, ip)
            if travel:
                require_otp = True
                suspicion_reason = travel

    if require_otp:
        code = generate_otp_code()
        challenge_token = await stash_otp_challenge(
            redis,
            user_id=user.id,
            device_hash=device_hash or "",
            ip=ip, ua=ua, code=code,
        )
        text, html = render_device_otp_email(code, ip, ua)
        bg.add_task(send_email, body.email, "รหัสยืนยันการเข้าสู่ระบบ", text, html)
        log_login_event(
            db, user=user, email=body.email, ip=ip, ua=ua,
            device_hash=device_hash, status="otp_required",
            suspicious=True, suspicion_reason=suspicion_reason,
        )
        db.commit()
        return Response(
            content=json.dumps({
                "otp_required": True,
                "challenge_token": challenge_token,
            }),
            media_type="application/json",
            status_code=202,
        )

    # Fast path: trusted device, no travel anomaly. Mint session immediately.
    if device_hash:
        trust_device(db, user_id=user.id, device_hash=device_hash, label=ua[:80], ip=ip)
    log_login_event(db, user=user, email=body.email, ip=ip, ua=ua,
                    device_hash=device_hash, status="ok")
    db.commit()
    await record_successful_login(redis, user.id, ip)
    token = create_jwt(str(user.id))
    response.set_cookie(
        "session", token,
        httponly=True, secure=True, samesite="strict",
        max_age=settings.JWT_TTL_MIN * 60, path="/",
    )
    return {"ok": True, "token": token}


class OtpConfirm(BaseModel):
    challenge_token: str
    code: str


@router.post("/device-otp/confirm")
async def confirm_device_otp(
    body: OtpConfirm,
    request: Request,
    response: Response,
    db: Session = Depends(get_session),
    redis: Redis = Depends(get_redis),
):
    """Verify the emailed OTP, promote the device to trusted, mint session."""
    payload = await consume_otp_challenge(
        redis, challenge_token=body.challenge_token, code=body.code,
    )
    if not payload:
        raise HTTPException(400, "invalid or expired code")
    user = db.get(User, payload["user_id"])
    if not user or not user.is_active:
        raise HTTPException(401, "user gone")

    ua = request.headers.get("user-agent", "")
    ip = _client_ip(request)
    if payload.get("device_hash"):
        trust_device(
            db, user_id=user.id, device_hash=payload["device_hash"],
            label=ua[:80], ip=ip,
        )
    log_login_event(db, user=user, email=user.email, ip=ip, ua=ua,
                    device_hash=payload.get("device_hash"), status="ok")
    db.commit()
    await record_successful_login(redis, user.id, ip)

    token = create_jwt(str(user.id))
    response.set_cookie(
        "session", token,
        httponly=True, secure=True, samesite="strict",
        max_age=settings.JWT_TTL_MIN * 60, path="/",
    )
    return {"ok": True, "token": token}


def _client_ip(request: Request) -> str | None:
    # Caddy already strips X-Forwarded-For from outside; trust the last hop.
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        return xff.split(",")[-1].strip()
    return request.client.host if request.client else None


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
    redis: Redis = Depends(get_redis),
):
    """Revoke this token (jti added to denylist) and clear the cookie.

    Stateless JWT can't be un-signed, so we keep a tiny per-jti deny entry
    in Redis that lives only as long as the token itself. After natural
    expiry the entry is gone — no unbounded growth.
    """
    token = request.cookies.get("session")
    if not token:
        auth_header = request.headers.get("authorization", "")
        if auth_header.lower().startswith("bearer "):
            token = auth_header.split(" ", 1)[1].strip()
    if token:
        try:
            payload = decode_jwt(token)
            jti = payload.get("jti")
            ttl = jwt_remaining_seconds(payload)
            if jti and ttl > 0:
                await redis.set(f"jwt:revoked:{jti}", "1", ex=ttl)
        except Exception:
            pass  # malformed token; cookie clear below is still safe
    response.delete_cookie("session", path="/")
    return {"ok": True}


@router.post("/logout-all")
async def logout_all(
    user: User = Depends(current_user),
    redis: Redis = Depends(get_redis),
    response: Response = None,
):
    """Revoke every token issued before now for this user. Use after a
    suspected compromise or when the user changes their password.

    Implementation: store `now` as a cutoff; subsequent token verification
    rejects any JWT whose `iat` is <= cutoff. Lives for one full token TTL.
    """
    cutoff = int(dt.datetime.now(dt.timezone.utc).timestamp())
    await redis.set(
        f"jwt:user_revoke:{user.id}", str(cutoff),
        ex=settings.JWT_TTL_MIN * 60,
    )
    if response is not None:
        response.delete_cookie("session", path="/")
    log.info("logout_all", target_user_id=str(user.id))
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
async def reset_password(
    body: TokenAndPassword,
    db: Session = Depends(get_session),
    redis: Redis = Depends(get_redis),
):
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
    # Invalidate every existing session for this user — a leaked token
    # shouldn't survive a password change.
    cutoff = int(dt.datetime.now(dt.timezone.utc).timestamp())
    await redis.set(
        f"jwt:user_revoke:{row.user_id}", str(cutoff),
        ex=settings.JWT_TTL_MIN * 60,
    )
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
