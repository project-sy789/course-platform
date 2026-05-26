"""Anti-account-sharing tests (device OTP + impossible-travel)."""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.config import settings
from app.models import LoginEvent, TrustedDevice
from app.antisharing import hash_device_id

pytestmark = pytest.mark.asyncio


@pytest.fixture
def antishare_on(monkeypatch):
    """Force anti-sharing on for the duration of one test."""
    monkeypatch.setattr(settings, "ANTI_SHARING_ENABLED", True)
    yield


async def test_login_without_device_id_returns_otp_challenge(
    client, db, make_user, antishare_on,
):
    make_user("alice@example.com", password="pw-pw-pw-pw", email_verified=True)
    r = await client.post(
        "/api/v1/auth/login",
        json={"email": "alice@example.com", "password": "pw-pw-pw-pw"},
    )
    assert r.status_code == 202
    body = r.json()
    assert body["otp_required"] is True
    assert "challenge_token" in body
    # No session cookie should be set on OTP-gated response.
    assert "session" not in r.cookies


async def test_login_with_unknown_device_returns_otp_challenge(
    client, db, make_user, antishare_on,
):
    make_user("alice@example.com", password="pw-pw-pw-pw", email_verified=True)
    r = await client.post(
        "/api/v1/auth/login",
        headers={"x-device-id": "device-abc-123"},
        json={"email": "alice@example.com", "password": "pw-pw-pw-pw"},
    )
    assert r.status_code == 202
    assert r.json()["otp_required"] is True


async def test_login_skips_otp_for_trusted_device(
    client, db, make_user, antishare_on,
):
    user = make_user("alice@example.com", password="pw-pw-pw-pw", email_verified=True)
    raw = "device-abc-123"
    db.add(TrustedDevice(user_id=user.id, device_hash=hash_device_id(raw),
                         label="test"))
    db.commit()

    r = await client.post(
        "/api/v1/auth/login",
        headers={"x-device-id": raw},
        json={"email": "alice@example.com", "password": "pw-pw-pw-pw"},
    )
    assert r.status_code == 200
    assert r.cookies.get("session")


async def test_confirm_otp_promotes_device_and_mints_session(
    client, db, fake_redis, make_user, antishare_on,
):
    make_user("alice@example.com", password="pw-pw-pw-pw", email_verified=True)
    raw_dev = "device-new"
    r = await client.post(
        "/api/v1/auth/login",
        headers={"x-device-id": raw_dev},
        json={"email": "alice@example.com", "password": "pw-pw-pw-pw"},
    )
    assert r.status_code == 202
    challenge = r.json()["challenge_token"]

    # Pull the issued OTP straight out of Redis (since SMTP is a no-op in test).
    import json
    raw = await fake_redis.get(f"login:otp:{challenge}")
    code = json.loads(raw)["code"]

    r = await client.post(
        "/api/v1/auth/device-otp/confirm",
        headers={"x-device-id": raw_dev},
        json={"challenge_token": challenge, "code": code},
    )
    assert r.status_code == 200
    assert r.cookies.get("session")
    # Device is now trusted.
    assert db.scalar(select(TrustedDevice).where(
        TrustedDevice.device_hash == hash_device_id(raw_dev)
    )) is not None


async def test_confirm_otp_rejects_wrong_code(
    client, db, fake_redis, make_user, antishare_on,
):
    make_user("alice@example.com", password="pw-pw-pw-pw", email_verified=True)
    r = await client.post(
        "/api/v1/auth/login",
        headers={"x-device-id": "dev-1"},
        json={"email": "alice@example.com", "password": "pw-pw-pw-pw"},
    )
    challenge = r.json()["challenge_token"]
    r = await client.post(
        "/api/v1/auth/device-otp/confirm",
        json={"challenge_token": challenge, "code": "000000"},
    )
    assert r.status_code == 400


async def test_login_event_is_recorded(client, db, make_user, antishare_on):
    make_user("alice@example.com", password="pw-pw-pw-pw", email_verified=True)
    await client.post(
        "/api/v1/auth/login",
        json={"email": "alice@example.com", "password": "wrong"},
    )
    bad = db.scalar(select(LoginEvent).where(LoginEvent.status == "bad_pw"))
    assert bad is not None


async def test_account_devices_list_and_revoke(
    client, db, make_user, auth_cookie,
):
    user = make_user()
    td = TrustedDevice(user_id=user.id, device_hash=hash_device_id("d1"), label="laptop")
    db.add(td); db.commit()

    r = await client.get("/api/v1/account/devices", cookies=auth_cookie(str(user.id)))
    assert r.status_code == 200
    rows = r.json()
    assert len(rows) == 1
    assert rows[0]["label"] == "laptop"

    r = await client.delete(f"/api/v1/account/devices/{td.id}",
                            cookies=auth_cookie(str(user.id)))
    assert r.status_code == 200
    assert db.scalar(select(TrustedDevice).where(TrustedDevice.id == td.id)) is None


async def test_user_cannot_revoke_other_users_device(
    client, db, make_user, auth_cookie,
):
    alice = make_user("alice@example.com")
    bob = make_user("bob@example.com")
    td = TrustedDevice(user_id=alice.id, device_hash=hash_device_id("d2"))
    db.add(td); db.commit()

    r = await client.delete(f"/api/v1/account/devices/{td.id}",
                            cookies=auth_cookie(str(bob.id)))
    assert r.status_code == 404
