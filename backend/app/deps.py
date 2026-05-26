import jwt as pyjwt
from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session
from sqlalchemy import select
from .db import get_session
from .auth import decode_jwt
from .models import User, Enrollment, Lesson


def current_user(request: Request, db: Session = Depends(get_session)) -> User:
    token = request.cookies.get("session")
    if not token:
        auth_header = request.headers.get("authorization", "")
        if auth_header.lower().startswith("bearer "):
            token = auth_header.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "auth required")
    try:
        payload = decode_jwt(token)
    except pyjwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid token")
    user = db.scalar(
        select(User).where(User.id == payload["sub"], User.is_active.is_(True))
    )
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "user not found")
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
    return lesson
