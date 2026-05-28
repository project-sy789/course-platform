"""Lesson progress + course completion summary.

Endpoints:
  PUT  /api/v1/lessons/{lesson_id}/progress   — upsert position; mark completed at >=90% watched
  GET  /api/v1/lessons/{lesson_id}/progress   — last position for current user
  GET  /api/v1/courses/{slug}/progress        — per-lesson + overall summary

Completion threshold of 90% is the industry default; finishes that fall short
(credits, end-card skips) still count as done. Only call PUT when the player
actually advances — no point upserting on every paint.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from ..db import get_session
from ..deps import current_user, require_enrollment_for_video
from ..models import Course, Lesson, LessonProgress, User

router = APIRouter(prefix="/api/v1", tags=["progress"])


@router.get("/account/resume")
def resume_from(
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
):
    """Most-recent in-progress lesson for the current user, if any. Powers
    the sticky 'เรียนต่อ' bar in the public chrome — returns 204 when there's
    nothing to resume so the bar stays hidden."""
    row = db.execute(
        select(LessonProgress, Lesson, Course)
        .join(Lesson, Lesson.id == LessonProgress.lesson_id)
        .join(Course, Course.id == Lesson.course_id)
        .where(
            LessonProgress.user_id == user.id,
            LessonProgress.completed == False,  # noqa: E712
            LessonProgress.position_seconds > 0,
        )
        .order_by(LessonProgress.updated_at.desc())
        .limit(1)
    ).first()
    if row is None:
        return None
    lp, lesson, course = row
    pct = (
        int(round((lp.position_seconds / lp.duration_seconds) * 100))
        if lp.duration_seconds > 0 else 0
    )
    return {
        "course_slug": course.slug,
        "course_title": course.title,
        "lesson_id": str(lesson.id),
        "lesson_title": lesson.title,
        "lesson_position": lesson.position,
        "watched_pct": pct,
        "updated_at": lp.updated_at.isoformat(),
    }

COMPLETION_RATIO = 0.9


class ProgressIn(BaseModel):
    position_seconds: int = Field(ge=0)
    duration_seconds: int = Field(ge=0)


@router.put("/lessons/{lesson_id}/progress")
def upsert_progress(
    lesson_id: str,
    body: ProgressIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
):
    lesson = db.get(Lesson, lesson_id)
    if not lesson:
        raise HTTPException(404, "lesson not found")
    require_enrollment_for_video(str(lesson.video_id), user, db)

    # Sanity: refuse positions past the duration. Frontend clamps too, but
    # don't trust it — a tampered client could otherwise set completed=true
    # on a lesson it never actually watched.
    pos = min(body.position_seconds, body.duration_seconds or body.position_seconds)
    completed = (
        body.duration_seconds > 0 and pos >= int(body.duration_seconds * COMPLETION_RATIO)
    )

    # Postgres upsert: one round-trip, no race window between SELECT and INSERT.
    # `completed` is sticky — once true it stays true even if the user scrubs back.
    stmt = pg_insert(LessonProgress).values(
        user_id=user.id, lesson_id=lesson.id,
        position_seconds=pos, duration_seconds=body.duration_seconds,
        completed=completed,
    ).on_conflict_do_update(
        index_elements=[LessonProgress.user_id, LessonProgress.lesson_id],
        set_={
            "position_seconds": pos,
            "duration_seconds": body.duration_seconds,
            "completed": LessonProgress.completed.op("OR")(completed),
            "updated_at": __import__("datetime").datetime.now(
                __import__("datetime").timezone.utc
            ),
        },
    )
    db.execute(stmt)
    db.commit()
    return {"position_seconds": pos, "completed": completed}


@router.get("/lessons/{lesson_id}/progress")
def get_progress(
    lesson_id: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
):
    lesson = db.get(Lesson, lesson_id)
    if not lesson:
        raise HTTPException(404, "lesson not found")
    require_enrollment_for_video(str(lesson.video_id), user, db)

    row = db.scalar(
        select(LessonProgress).where(
            LessonProgress.user_id == user.id,
            LessonProgress.lesson_id == lesson.id,
        )
    )
    if not row:
        return {"position_seconds": 0, "duration_seconds": 0, "completed": False}
    return {
        "position_seconds": row.position_seconds,
        "duration_seconds": row.duration_seconds,
        "completed": row.completed,
        "updated_at": row.updated_at.isoformat(),
    }


@router.get("/courses/{slug}/progress")
def course_progress_summary(
    slug: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
):
    course = db.scalar(select(Course).where(Course.slug == slug))
    if not course:
        raise HTTPException(404, "course not found")

    lessons = db.scalars(
        select(Lesson).where(Lesson.course_id == course.id).order_by(Lesson.position.asc())
    ).all()
    if not lessons:
        return {"course_slug": slug, "completed_lessons": 0, "total_lessons": 0,
                "lessons": []}

    progress_rows = db.scalars(
        select(LessonProgress).where(
            LessonProgress.user_id == user.id,
            LessonProgress.lesson_id.in_([l.id for l in lessons]),
        )
    ).all()
    by_lesson = {p.lesson_id: p for p in progress_rows}

    items = []
    completed = 0
    for l in lessons:
        p = by_lesson.get(l.id)
        if p and p.completed:
            completed += 1
        items.append({
            "lesson_id": str(l.id),
            "title": l.title,
            "position": l.position,
            "position_seconds": p.position_seconds if p else 0,
            "duration_seconds": p.duration_seconds if p else 0,
            "completed": bool(p and p.completed),
        })

    return {
        "course_slug": slug,
        "completed_lessons": completed,
        "total_lessons": len(lessons),
        "lessons": items,
    }
