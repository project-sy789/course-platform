import datetime as dt
import jwt as pyjwt
import structlog
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from sqlalchemy import select
from redis.asyncio import Redis
from .db import get_session, get_redis
from .auth import decode_jwt
from .models import User, Enrollment, Lesson


def _extract_token(request: Request) -> str | None:
    token = request.cookies.get("session")
    if token:
        return token
    auth_header = request.headers.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        return auth_header.split(" ", 1)[1].strip()
    return None


async def current_user(
    request: Request,
    db: Session = Depends(get_session),
    redis: Redis = Depends(get_redis),
) -> User:
    token = _extract_token(request)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "auth required")
    try:
        payload = decode_jwt(token)
    except pyjwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid token")

    # Per-token revocation: jti in Redis denylist means logged-out.
    jti = payload.get("jti")
    if jti and await redis.get(f"jwt:revoked:{jti}"):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "token revoked")

    # Per-user mass revocation (e.g. "log out all sessions" / password change).
    # Tokens issued before the user's `revoke_all_before` timestamp are denied.
    user_revoke = await redis.get(f"jwt:user_revoke:{payload['sub']}")
    if user_revoke and int(user_revoke) >= int(payload.get("iat", 0)):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "token revoked")

    user = db.scalar(
        select(User).where(User.id == payload["sub"], User.is_active.is_(True))
    )
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "user not found")
    structlog.contextvars.bind_contextvars(user_id=str(user.id))
    return user


def current_admin(user: User = Depends(current_user)) -> User:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "admin only")
    return user


def require_enrollment_for_video(video_id: str, user: User, db: Session) -> Lesson:
    lesson = db.scalar(select(Lesson).where(Lesson.video_id == video_id))
    if not lesson:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "video not found")
    if lesson.is_preview:
        return lesson
    enrolled = db.scalar(
        select(Enrollment).where(
            Enrollment.user_id == user.id,
            Enrollment.course_id == lesson.course_id,
        )
    )
    if not enrolled:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not enrolled")
    if enrolled.expires_at is not None and enrolled.expires_at <= dt.datetime.now(dt.timezone.utc):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "enrollment expired")
    return lesson


def compute_enrollment_expiry(course) -> "dt.datetime | None":
    """Return the expires_at for a fresh enrollment, or None for lifetime courses.

    Centralised so every entry point that creates an Enrollment (admin grant,
    payment webhook, manual slip approval) computes expiry the same way."""
    if course.access_duration_days is None or course.access_duration_days <= 0:
        return None
    return dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=course.access_duration_days)

