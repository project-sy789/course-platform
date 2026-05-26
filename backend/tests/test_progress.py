"""Lesson progress tests."""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models import Lesson, LessonProgress

pytestmark = pytest.mark.asyncio


async def _enrolled_lesson(db, make_user, make_video_with_key, enroll, auth_cookie):
    user = make_user("alice@example.com")
    video, _ = make_video_with_key()
    lesson = db.scalar(select(Lesson).where(Lesson.video_id == video.id))
    enroll(user, lesson.course_id)
    return user, lesson, auth_cookie(str(user.id))


async def test_progress_requires_auth(client, db, make_video_with_key):
    video, _ = make_video_with_key()
    lesson = db.scalar(select(Lesson).where(Lesson.video_id == video.id))
    r = await client.put(f"/api/v1/lessons/{lesson.id}/progress",
                         json={"position_seconds": 5, "duration_seconds": 100})
    assert r.status_code == 401


async def test_progress_requires_enrollment(
    client, db, make_user, make_video_with_key, auth_cookie
):
    user = make_user("eve@example.com")
    video, _ = make_video_with_key()
    lesson = db.scalar(select(Lesson).where(Lesson.video_id == video.id))
    r = await client.put(
        f"/api/v1/lessons/{lesson.id}/progress",
        cookies=auth_cookie(str(user.id)),
        json={"position_seconds": 10, "duration_seconds": 100},
    )
    assert r.status_code == 403


async def test_progress_upsert_then_read(
    client, db, make_user, make_video_with_key, enroll, auth_cookie
):
    user, lesson, cookies = await _enrolled_lesson(db, make_user, make_video_with_key,
                                                    enroll, auth_cookie)
    r = await client.put(
        f"/api/v1/lessons/{lesson.id}/progress",
        cookies=cookies, json={"position_seconds": 30, "duration_seconds": 600},
    )
    assert r.status_code == 200
    assert r.json()["completed"] is False

    r = await client.get(f"/api/v1/lessons/{lesson.id}/progress", cookies=cookies)
    assert r.status_code == 200
    assert r.json()["position_seconds"] == 30
    assert r.json()["completed"] is False


async def test_progress_marks_completed_at_90_percent(
    client, db, make_user, make_video_with_key, enroll, auth_cookie
):
    user, lesson, cookies = await _enrolled_lesson(db, make_user, make_video_with_key,
                                                    enroll, auth_cookie)
    r = await client.put(
        f"/api/v1/lessons/{lesson.id}/progress",
        cookies=cookies, json={"position_seconds": 540, "duration_seconds": 600},
    )
    assert r.json()["completed"] is True


async def test_progress_completed_is_sticky(
    client, db, make_user, make_video_with_key, enroll, auth_cookie
):
    """Once a lesson is completed, scrubbing back doesn't un-complete it."""
    user, lesson, cookies = await _enrolled_lesson(db, make_user, make_video_with_key,
                                                    enroll, auth_cookie)
    await client.put(
        f"/api/v1/lessons/{lesson.id}/progress",
        cookies=cookies, json={"position_seconds": 600, "duration_seconds": 600},
    )
    # User scrubs back near the start
    await client.put(
        f"/api/v1/lessons/{lesson.id}/progress",
        cookies=cookies, json={"position_seconds": 5, "duration_seconds": 600},
    )
    row = db.scalar(
        select(LessonProgress).where(
            LessonProgress.user_id == user.id, LessonProgress.lesson_id == lesson.id,
        )
    )
    assert row.completed is True
    assert row.position_seconds == 5  # position itself does update


async def test_position_clamped_to_duration(
    client, db, make_user, make_video_with_key, enroll, auth_cookie
):
    """Tampered client claiming position > duration shouldn't auto-complete."""
    user, lesson, cookies = await _enrolled_lesson(db, make_user, make_video_with_key,
                                                    enroll, auth_cookie)
    r = await client.put(
        f"/api/v1/lessons/{lesson.id}/progress",
        cookies=cookies, json={"position_seconds": 9999, "duration_seconds": 100},
    )
    body = r.json()
    assert body["position_seconds"] == 100  # clamped
    assert body["completed"] is True


async def test_course_progress_summary(
    client, db, make_user, make_video_with_key, enroll, auth_cookie
):
    from app.models import Course, Lesson as LessonModel, Video, VideoKey
    import secrets
    from app.crypto import encrypt_video_key

    user = make_user("alice@example.com")
    course = Course(slug="multi", title="Multi-lesson")
    db.add(course); db.flush()

    lesson_ids = []
    for i in range(3):
        v = Video(r2_manifest_key=f"courses/multi/lessons/{i}/master.m3u8")
        db.add(v); db.flush()
        ct, nonce, tag = encrypt_video_key(secrets.token_bytes(16))
        db.add(VideoKey(video_id=v.id, key_ciphertext=ct, key_nonce=nonce, key_tag=tag))
        l = LessonModel(course_id=course.id, video_id=v.id, title=f"L{i}",
                        position=i + 1, is_preview=False)
        db.add(l); db.flush()
        lesson_ids.append(l.id)
    db.commit()

    enroll(user, course.id)
    cookies = auth_cookie(str(user.id))

    # Complete 2 of 3
    for lid in lesson_ids[:2]:
        await client.put(
            f"/api/v1/lessons/{lid}/progress",
            cookies=cookies, json={"position_seconds": 100, "duration_seconds": 100},
        )

    r = await client.get("/api/v1/courses/multi/progress", cookies=cookies)
    assert r.status_code == 200
    body = r.json()
    assert body["total_lessons"] == 3
    assert body["completed_lessons"] == 2
    assert len(body["lessons"]) == 3
