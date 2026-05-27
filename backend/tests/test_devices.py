"""Tests for the self-service device management endpoints."""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.antisharing import hash_device_id
from app.models import TrustedDevice


pytestmark = pytest.mark.asyncio


def _add_device(db, user_id, raw_did: str, label: str):
    td = TrustedDevice(
        user_id=user_id,
        device_hash=hash_device_id(raw_did),
        label=label,
    )
    db.add(td); db.commit()
    return td


async def test_list_devices_marks_current(client, db, make_user, auth_cookie):
    user = make_user("a@example.com")
    _add_device(db, user.id, "device-A", "Chrome on macOS")
    _add_device(db, user.id, "device-B", "Safari on iPhone")

    r = await client.get(
        "/api/v1/account/devices",
        cookies=auth_cookie(str(user.id)),
        headers={"X-Device-Id": "device-A"},
    )
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 2
    by_label = {x["label"]: x for x in rows}
    assert by_label["Chrome on macOS"]["current"] is True
    assert by_label["Safari on iPhone"]["current"] is False


async def test_revoke_single_device(client, db, make_user, auth_cookie):
    user = make_user("b@example.com")
    td = _add_device(db, user.id, "device-X", "Old Chromebook")

    r = await client.delete(
        f"/api/v1/account/devices/{td.id}",
        cookies=auth_cookie(str(user.id)),
    )
    assert r.status_code == 200
    db.expire_all()
    assert db.get(TrustedDevice, td.id) is None


async def test_revoke_other_users_device_forbidden(
    client, db, make_user, auth_cookie,
):
    me = make_user("me@example.com")
    other = make_user("other@example.com")
    td = _add_device(db, other.id, "their-device", "Their laptop")

    r = await client.delete(
        f"/api/v1/account/devices/{td.id}",
        cookies=auth_cookie(str(me.id)),
    )
    assert r.status_code == 404  # not found = "not yours"
    assert db.get(TrustedDevice, td.id) is not None


async def test_revoke_all_clears_devices_and_kills_jwts(
    client, db, make_user, auth_cookie,
):
    user = make_user("c@example.com")
    _add_device(db, user.id, "d1", "Phone")
    _add_device(db, user.id, "d2", "Tablet")
    cookies = auth_cookie(str(user.id))

    # Sanity: caller is authenticated right now
    pre = await client.get("/api/v1/auth/me", cookies=cookies)
    assert pre.status_code == 200

    r = await client.post(
        "/api/v1/account/devices/revoke-all",
        cookies=cookies,
    )
    assert r.status_code == 200

    db.expire_all()
    remaining = db.scalars(
        select(TrustedDevice).where(TrustedDevice.user_id == user.id)
    ).all()
    assert remaining == []

    # Existing JWT cookie should now be rejected by current_user.
    post = await client.get("/api/v1/auth/me", cookies=cookies)
    assert post.status_code == 401
