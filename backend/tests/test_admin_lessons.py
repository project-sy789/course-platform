"""Admin lesson management — PATCH/DELETE /admin/lessons/{id}."""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models import Lesson, LessonEntitlement

pytestmark = pytest.mark.asyncio


async def test_patch_lesson_renames_and_toggles_preview(
    client, db, make_user, make_video_with_key, auth_cookie,
):
    admin = make_user("admin@example.com", is_admin=True)
    video, _ = make_video_with_key()
    lesson = db.scalar(select(Lesson).where(Lesson.video_id == video.id))

    r = await client.patch(
        f"/api/v1/admin/lessons/{lesson.id}",
        cookies=auth_cookie(str(admin.id)),
        json={"title": "บทเปลี่ยนชื่อ", "is_preview": True, "price_baht": 9900},
    )
    assert r.status_code == 200, r.text
    db.refresh(lesson)
    assert lesson.title == "บทเปลี่ยนชื่อ"
    assert lesson.is_preview is True
    assert lesson.price_baht == 9900


async def test_patch_lesson_position_swaps_with_occupant(
    client, db, make_user, make_video_with_key, auth_cookie,
):
    admin = make_user("admin@example.com", is_admin=True)
    video1, _ = make_video_with_key(course_slug="c1", lesson_title="A")
    l1 = db.scalar(select(Lesson).where(Lesson.video_id == video1.id))
    course_id = l1.course_id

    # Add a second lesson at position 2 in the same course
    from app.models import Video, VideoKey, Lesson as LessonM
    import secrets, uuid
    from app.crypto import encrypt_video_key
    v2 = Video(id=uuid.uuid4(), r2_manifest_key="x")
    db.add(v2); db.flush()
    l2 = LessonM(course_id=course_id, video_id=v2.id, title="B", position=2)
    db.add(l2)
    pt = secrets.token_bytes(16)
    ct, n, t = encrypt_video_key(pt)
    db.add(VideoKey(video_id=v2.id, key_ciphertext=ct, key_nonce=n, key_tag=t))
    db.commit()

    r = await client.patch(
        f"/api/v1/admin/lessons/{l1.id}",
        cookies=auth_cookie(str(admin.id)),
        json={"position": 2},
    )
    assert r.status_code == 200, r.text
    db.refresh(l1); db.refresh(l2)
    assert l1.position == 2
    assert l2.position == 1


async def test_delete_lesson_refuses_when_entitlements_exist(
    client, db, make_user, make_video_with_key, auth_cookie,
):
    admin = make_user("admin@example.com", is_admin=True)
    student = make_user("s@example.com")
    video, _ = make_video_with_key()
    lesson = db.scalar(select(Lesson).where(Lesson.video_id == video.id))
    db.add(LessonEntitlement(user_id=student.id, lesson_id=lesson.id))
    db.commit()

    r = await client.delete(
        f"/api/v1/admin/lessons/{lesson.id}",
        cookies=auth_cookie(str(admin.id)),
    )
    assert r.status_code == 409


async def test_delete_lesson_succeeds_when_no_entitlements(
    client, db, make_user, make_video_with_key, auth_cookie,
):
    admin = make_user("admin@example.com", is_admin=True)
    video, _ = make_video_with_key()
    lesson = db.scalar(select(Lesson).where(Lesson.video_id == video.id))
    lesson_id = lesson.id

    r = await client.delete(
        f"/api/v1/admin/lessons/{lesson_id}",
        cookies=auth_cookie(str(admin.id)),
    )
    assert r.status_code == 200
    assert db.get(Lesson, lesson_id) is None


async def test_patch_lesson_requires_admin(
    client, db, make_user, make_video_with_key, auth_cookie,
):
    user = make_user("u@example.com")  # not admin
    video, _ = make_video_with_key()
    lesson = db.scalar(select(Lesson).where(Lesson.video_id == video.id))

    r = await client.patch(
        f"/api/v1/admin/lessons/{lesson.id}",
        cookies=auth_cookie(str(user.id)),
        json={"title": "nope"},
    )
    assert r.status_code == 403
