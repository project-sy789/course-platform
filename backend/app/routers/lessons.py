import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import select

from ..db import get_session
from ..deps import current_user
from ..models import User, Course, Lesson, Enrollment

router = APIRouter(prefix="/api/v1", tags=["lessons"])


@router.get("/courses")
def list_courses(db: Session = Depends(get_session)):
    rows = db.scalars(select(Course).order_by(Course.created_at.desc())).all()
    return [
        {"id": str(c.id), "slug": c.slug, "title": c.title,
         "description": c.description, "price_cents": c.price_cents,
         "access_duration_days": c.access_duration_days}
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
        "price_cents": course.price_cents,
        "access_duration_days": course.access_duration_days,
        "lessons": [
            {"id": str(l.id), "title": l.title, "position": l.position, "is_preview": l.is_preview}
            for l in lessons
        ],
    }


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

    return {
        "id": str(lesson.id),
        "title": lesson.title,
        "position": lesson.position,
        "video_id": str(lesson.video_id),
        "course_id": str(lesson.course_id),
    }
