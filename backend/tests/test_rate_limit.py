"""Tests for per-key rate limit + concurrent session cap."""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.config import settings
from app.models import Lesson

pytestmark = pytest.mark.asyncio


async def test_concurrent_session_cap_enforced(
    client, db, make_user, make_video_with_key, enroll, auth_cookie, monkeypatch
):
    monkeypatch.setattr(settings, "MAX_CONCURRENT_SESSIONS", 2)
    user = make_user("alice@example.com")
    video, _ = make_video_with_key()
    lesson = db.scalar(select(Lesson).where(Lesson.video_id == video.id))
    enroll(user, lesson.course_id)

    headers = {"User-Agent": "test/1.0", "X-Real-IP": "10.0.0.1"}
    cookies = auth_cookie(str(user.id))

    for _ in range(2):
        r = await client.post(
            f"/api/v1/videos/{video.id}/playback-session",
            cookies=cookies, headers=headers,
        )
        assert r.status_code == 200

    r = await client.post(
        f"/api/v1/videos/{video.id}/playback-session",
        cookies=cookies, headers=headers,
    )
    assert r.status_code == 429
    assert "too many" in r.json()["detail"].lower()


async def test_per_key_rate_limit_enforced(
    client, db, make_user, make_video_with_key, enroll, auth_cookie, monkeypatch
):
    monkeypatch.setattr(settings, "KEY_RATE_LIMIT_PER_MIN", 3)
    user = make_user("alice@example.com")
    video, _ = make_video_with_key()
    lesson = db.scalar(select(Lesson).where(Lesson.video_id == video.id))
    enroll(user, lesson.course_id)

    headers = {"User-Agent": "test/1.0", "X-Real-IP": "10.0.0.1"}
    cookies = auth_cookie(str(user.id))

    r = await client.post(
        f"/api/v1/videos/{video.id}/playback-session",
        cookies=cookies, headers=headers,
    )
    key_path = r.json()["key_url_template"]

    for _ in range(3):
        ok = await client.get(key_path, cookies=cookies, headers=headers)
        assert ok.status_code == 200

    blocked = await client.get(key_path, cookies=cookies, headers=headers)
    assert blocked.status_code == 429
