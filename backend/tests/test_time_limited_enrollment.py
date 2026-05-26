"""Time-limited enrollment tests (ขายแบบจำกัดเวลา)."""
from __future__ import annotations

import datetime as dt
import pytest
from sqlalchemy import select

from app.models import Course, Enrollment, Lesson

pytestmark = pytest.mark.asyncio


async def test_get_lesson_blocked_after_enrollment_expires(
    client, db, make_user, make_video_with_key, enroll, auth_cookie,
):
    user = make_user("alice@example.com")
    video, _ = make_video_with_key()
    lesson = db.scalar(select(Lesson).where(Lesson.video_id == video.id))
    e = enroll(user, lesson.course_id)
    e.expires_at = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=1)
    db.commit()

    r = await client.get(f"/api/v1/lessons/{lesson.id}",
                         cookies=auth_cookie(str(user.id)))
    assert r.status_code == 403
    assert "expired" in r.json()["detail"].lower()


async def test_get_lesson_ok_while_enrollment_unexpired(
    client, db, make_user, make_video_with_key, enroll, auth_cookie,
):
    user = make_user("alice@example.com")
    video, _ = make_video_with_key()
    lesson = db.scalar(select(Lesson).where(Lesson.video_id == video.id))
    e = enroll(user, lesson.course_id)
    e.expires_at = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=30)
    db.commit()

    r = await client.get(f"/api/v1/lessons/{lesson.id}",
                         cookies=auth_cookie(str(user.id)))
    assert r.status_code == 200


async def test_get_lesson_ok_for_lifetime_enrollment(
    client, db, make_user, make_video_with_key, enroll, auth_cookie,
):
    """expires_at = NULL means lifetime access (ขายขาด)."""
    user = make_user("alice@example.com")
    video, _ = make_video_with_key()
    lesson = db.scalar(select(Lesson).where(Lesson.video_id == video.id))
    e = enroll(user, lesson.course_id)
    assert e.expires_at is None  # default

    r = await client.get(f"/api/v1/lessons/{lesson.id}",
                         cookies=auth_cookie(str(user.id)))
    assert r.status_code == 200


async def test_admin_grant_sets_expiry_from_course_duration(
    client, db, make_user, auth_cookie,
):
    admin = make_user("admin@example.com", is_admin=True)
    student = make_user("student@example.com")
    course = Course(slug="paid", title="Paid", price_cents=10000,
                    access_duration_days=30)
    db.add(course); db.commit()

    r = await client.post(
        "/api/v1/admin/enrollments",
        cookies=auth_cookie(str(admin.id)),
        json={"user_email": "student@example.com", "course_slug": "paid"},
    )
    assert r.status_code == 200

    enr = db.scalar(select(Enrollment).where(Enrollment.user_id == student.id))
    assert enr is not None
    assert enr.expires_at is not None
    delta = enr.expires_at - dt.datetime.now(dt.timezone.utc)
    # Allow ±1 minute slop for test execution time.
    assert dt.timedelta(days=29, hours=23, minutes=59) < delta <= dt.timedelta(days=30)


async def test_admin_grant_lifetime_when_course_has_no_duration(
    client, db, make_user, auth_cookie,
):
    admin = make_user("admin@example.com", is_admin=True)
    student = make_user("student@example.com")
    course = Course(slug="lifetime", title="Lifetime", price_cents=0,
                    access_duration_days=None)
    db.add(course); db.commit()

    r = await client.post(
        "/api/v1/admin/enrollments",
        cookies=auth_cookie(str(admin.id)),
        json={"user_email": "student@example.com", "course_slug": "lifetime"},
    )
    assert r.status_code == 200
    enr = db.scalar(select(Enrollment).where(Enrollment.user_id == student.id))
    assert enr.expires_at is None
