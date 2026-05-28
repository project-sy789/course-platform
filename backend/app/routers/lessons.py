import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session
from sqlalchemy import select

from ..db import get_session
from ..deps import current_user
from ..models import User, Course, Lesson, Enrollment
from ..r2 import get_bytes

router = APIRouter(prefix="/api/v1", tags=["lessons"])


def _cover_url(c: Course) -> str | None:
    return f"/api/v1/courses/{c.slug}/cover" if c.cover_image_key else None


@router.get("/courses")
def list_courses(db: Session = Depends(get_session)):
    rows = db.scalars(select(Course).order_by(Course.created_at.desc())).all()
    return [
        {"id": str(c.id), "slug": c.slug, "title": c.title,
         "description": c.description, "price_baht": c.price_baht,
         "access_duration_days": c.access_duration_days,
         "is_featured": c.is_featured,
         "cover_url": _cover_url(c)}
        for c in rows
    ]


@router.get("/courses/{slug}")
def get_course(slug: str, db: Session = Depends(get_session)):
    course = db.scalar(select(Course).where(Course.slug == slug))
    if not course:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "course not found")
    lessons = db.scalars(
        select(Lesson).where(Lesson.course_id == course.id).order_by(Lesson.position.asc())
    ).all()
    return {
        "id": str(course.id),
        "slug": course.slug,
        "title": course.title,
        "description": course.description,
        "price_baht": course.price_baht,
        "access_duration_days": course.access_duration_days,
        "pixel_watermark": course.pixel_watermark,
        "is_featured": course.is_featured,
        "cover_url": _cover_url(course),
        "lessons": [
            {"id": str(l.id), "title": l.title, "position": l.position,
             "is_preview": l.is_preview, "price_baht": l.price_baht}
            for l in lessons
        ],
    }


@router.get("/courses/{slug}/cover")
def get_course_cover(slug: str, db: Session = Depends(get_session)):
    course = db.scalar(select(Course).where(Course.slug == slug))
    if not course or not course.cover_image_key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no cover")
    key = course.cover_image_key
    ext = key.rsplit(".", 1)[-1].lower()
    ctype = {"jpg": "image/jpeg", "jpeg": "image/jpeg",
             "png": "image/png", "webp": "image/webp"}.get(ext, "application/octet-stream")
    data = get_bytes(key)
    return Response(
        content=data,
        media_type=ctype,
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.get("/lessons/{lesson_id}")
def get_lesson(
    lesson_id: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
):
    lesson = db.get(Lesson, lesson_id)
    if not lesson:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "lesson not found")

    if not lesson.is_preview:
        now = dt.datetime.now(dt.timezone.utc)
        enrolled = db.scalar(
            select(Enrollment).where(
                Enrollment.user_id == user.id,
                Enrollment.course_id == lesson.course_id,
            )
        )
        course_ok = bool(enrolled) and (enrolled.expires_at is None or enrolled.expires_at > now)

        from ..models import LessonEntitlement
        ent = db.scalar(
            select(LessonEntitlement).where(
                LessonEntitlement.user_id == user.id,
                LessonEntitlement.lesson_id == lesson.id,
            )
        )
        lesson_ok = bool(ent) and (ent.expires_at is None or ent.expires_at > now)

        if not (course_ok or lesson_ok):
            if enrolled or ent:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "enrollment expired")
            raise HTTPException(status.HTTP_403_FORBIDDEN, "not enrolled")

    return {
        "id": str(lesson.id),
        "title": lesson.title,
        "position": lesson.position,
        "video_id": str(lesson.video_id),
        "course_id": str(lesson.course_id),
    }
