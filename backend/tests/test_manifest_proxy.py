"""Tests for the HLS manifest proxy + 10-second single-use nonce design.

The proxy must:
  * Refuse manifest fetches without a valid session token.
  * Rewrite #EXT-X-KEY to a /key URL bound to a fresh single-use nonce.
  * Rewrite each segment line to a presigned URL (we just check it isn't
    the original literal — the actual presign target is mocked).
  * Burn the key nonce on first redemption (second use → 403).
"""
from __future__ import annotations

from unittest.mock import patch
import pytest
from sqlalchemy import select

from app.models import Lesson


pytestmark = pytest.mark.asyncio


SAMPLE_MANIFEST = (
    "#EXTM3U\n"
    "#EXT-X-VERSION:3\n"
    "#EXT-X-TARGETDURATION:6\n"
    '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x0123456789abcdef0123456789abcdef\n'
    "#EXTINF:6.0,\n"
    "seg0.ts\n"
    "#EXTINF:6.0,\n"
    "seg1.ts\n"
    "#EXT-X-ENDLIST\n"
)


@pytest.fixture
def patched_r2():
    """Replace R2 IO with deterministic stand-ins so the proxy can run offline."""
    with patch("app.routers.videos.get_bytes", return_value=SAMPLE_MANIFEST.encode()) as g, \
         patch("app.routers.videos.presigned_get_url",
               side_effect=lambda key, expires_in=10: f"https://r2.test/{key}?sig=stub") as p:
        yield g, p


async def _open_session(client, db, make_user, make_video_with_key, enroll, auth_cookie):
    user = make_user("alice@example.com")
    video, _ = make_video_with_key()
    lesson = db.scalar(select(Lesson).where(Lesson.video_id == video.id))
    enroll(user, lesson.course_id)
    headers = {"User-Agent": "test/1.0", "X-Real-IP": "10.0.0.1"}
    r = await client.post(
        f"/api/v1/videos/{video.id}/playback-session",
        cookies=auth_cookie(str(user.id)),
        headers=headers,
    )
    assert r.status_code == 200
    return user, video, headers, r.json()


async def test_manifest_requires_valid_session(client, make_video_with_key):
    video, _ = make_video_with_key()
    r = await client.get(f"/api/v1/videos/{video.id}/manifest?s=bogus")
    assert r.status_code == 403


async def test_manifest_rewrites_key_and_segments(
    client, db, make_user, make_video_with_key, enroll, auth_cookie, patched_r2,
):
    _, video, headers, body = await _open_session(
        client, db, make_user, make_video_with_key, enroll, auth_cookie,
    )
    r = await client.get(body["manifest_url"], headers=headers)
    assert r.status_code == 200
    text = r.text

    # Original segment names are gone, replaced by presigned URLs.
    assert "seg0.ts\n" not in text
    assert "seg1.ts\n" not in text
    assert "https://r2.test/" in text

    # Key URI now points at our /key endpoint with a single-use nonce, IV preserved.
    assert "#EXT-X-KEY:METHOD=AES-128,URI=\"/api/v1/videos/" in text
    assert "&n=" in text
    assert "IV=0x0123456789abcdef0123456789abcdef" in text


async def test_key_nonce_is_single_use(
    client, db, make_user, make_video_with_key, enroll, auth_cookie, patched_r2,
):
    import re
    user, video, headers, body = await _open_session(
        client, db, make_user, make_video_with_key, enroll, auth_cookie,
    )
    r = await client.get(body["manifest_url"], headers=headers)
    m = re.search(r'URI="([^"]+)"', r.text)
    assert m, "rewritten key URI missing"
    key_url = m.group(1)

    cookies = auth_cookie(str(user.id))
    r1 = await client.get(key_url, cookies=cookies, headers=headers)
    assert r1.status_code == 200
    assert len(r1.content) == 16

    r2 = await client.get(key_url, cookies=cookies, headers=headers)
    assert r2.status_code == 403
    assert "expired" in r2.json()["detail"].lower()


async def test_each_manifest_fetch_mints_fresh_key_nonce(
    client, db, make_user, make_video_with_key, enroll, auth_cookie, patched_r2,
):
    """Two manifest GETs in the same session must yield two distinct key nonces.

    This is the property that gives us 'effective key rotation' even though
    the underlying AES bytes are stable — every manifest refresh produces a
    new short-lived key URL."""
    import re
    _, _, headers, body = await _open_session(
        client, db, make_user, make_video_with_key, enroll, auth_cookie,
    )
    r1 = await client.get(body["manifest_url"], headers=headers)
    r2 = await client.get(body["manifest_url"], headers=headers)
    n1 = re.search(r"&n=([^\"]+)", r1.text).group(1)
    n2 = re.search(r"&n=([^\"]+)", r2.text).group(1)
    assert n1 != n2
