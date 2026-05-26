"""Per-lesson purchase tests (ขายขาดแยกรายบท)."""
from __future__ import annotations

import datetime as dt
import pytest
from sqlalchemy import select

from app.models import Lesson, LessonEntitlement

pytestmark = pytest.mark.asyncio


async def test_lesson_entitlement_grants_access_without_course_enrollment(
    client, db, make_user, make_video_with_key, auth_cookie,
):
    user = make_user("alice@example.com")
    video, _ = make_video_with_key()
    lesson = db.scalar(select(Lesson).where(Lesson.video_id == video.id))
    db.add(LessonEntitlement(user_id=user.id, lesson_id=lesson.id))
    db.commit()

    r = await client.get(f"/api/v1/lessons/{lesson.id}",
                         cookies=auth_cookie(str(user.id)))
    assert r.status_code == 200


async def test_expired_lesson_entitlement_blocks_access(
    client, db, make_user, make_video_with_key, auth_cookie,
):
    user = make_user("alice@example.com")
    video, _ = make_video_with_key()
    lesson = db.scalar(select(Lesson).where(Lesson.video_id == video.id))
    db.add(LessonEntitlement(
        user_id=user.id, lesson_id=lesson.id,
        expires_at=dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1),
    ))
    db.commit()

    r = await client.get(f"/api/v1/lessons/{lesson.id}",
                         cookies=auth_cookie(str(user.id)))
    assert r.status_code == 403


async def test_admin_grant_lesson_entitlement(
    client, db, make_user, make_video_with_key, auth_cookie,
):
    admin = make_user("admin@example.com", is_admin=True)
    student = make_user("student@example.com")
    video, _ = make_video_with_key()
    lesson = db.scalar(select(Lesson).where(Lesson.video_id == video.id))

    r = await client.post(
        "/api/v1/admin/lesson-entitlements",
        cookies=auth_cookie(str(admin.id)),
        json={
            "user_email": "student@example.com",
            "lesson_id": str(lesson.id),
            "duration_days": 30,
        },
    )
    assert r.status_code == 200

    ent = db.scalar(select(LessonEntitlement).where(
        LessonEntitlement.user_id == student.id,
        LessonEntitlement.lesson_id == lesson.id,
    ))
    assert ent is not None
    assert ent.expires_at is not None

    # Non-admin cannot grant
    other = make_user("other@example.com")
    r = await client.post(
        "/api/v1/admin/lesson-entitlements",
        cookies=auth_cookie(str(other.id)),
        json={"user_email": "student@example.com", "lesson_id": str(lesson.id)},
    )
    assert r.status_code == 403
