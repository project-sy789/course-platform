"""Auth flow tests."""
from __future__ import annotations

import datetime as dt
import hashlib
import pytest
from sqlalchemy import select

from app.models import EmailToken, User

pytestmark = pytest.mark.asyncio


async def test_register_creates_unverified_user(client, db):
    r = await client.post("/api/v1/auth/register",
                          json={"email": "alice@example.com", "password": "pw-pw-pw-pw"})
    assert r.status_code == 201
    assert r.json()["email_verified"] is False

    user = db.scalar(select(User).where(User.email == "alice@example.com"))
    assert user.email_verified is False
    # Verification token is issued
    token = db.scalar(select(EmailToken).where(EmailToken.user_id == user.id))
    assert token is not None
    assert token.purpose == "verify"


async def test_login_blocked_until_email_verified(client, db, make_user):
    make_user("bob@example.com", password="pw-pw-pw-pw", email_verified=False)
    r = await client.post("/api/v1/auth/login",
                          json={"email": "bob@example.com", "password": "pw-pw-pw-pw"})
    assert r.status_code == 403
    assert "email not verified" in r.json()["detail"].lower()


async def test_login_succeeds_after_verification(client, make_user):
    make_user("alice@example.com", password="pw-pw-pw-pw", email_verified=True)
    r = await client.post("/api/v1/auth/login",
                          json={"email": "alice@example.com", "password": "pw-pw-pw-pw"})
    assert r.status_code == 200
    assert r.cookies.get("session")


async def test_verify_email_with_valid_token(client, db, make_user):
    user = make_user("alice@example.com", email_verified=False)
    raw = "raw-token-abcdef"
    db.add(EmailToken(
        user_id=user.id, purpose="verify",
        token_hash=hashlib.sha256(raw.encode()).hexdigest(),
        expires_at=dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=1),
    ))
    db.commit()

    r = await client.post(f"/api/v1/auth/verify-email?token={raw}")
    assert r.status_code == 200
    db.refresh(user)
    assert user.email_verified is True


async def test_verify_email_with_invalid_token_rejected(client):
    r = await client.post("/api/v1/auth/verify-email?token=nope")
    assert r.status_code == 400


async def test_password_reset_flow(client, db, make_user):
    user = make_user("alice@example.com", password="old-pw-pw-pw", email_verified=True)

    # Request reset (always 202 to prevent enumeration)
    r = await client.post("/api/v1/auth/request-password-reset",
                          json={"email": "alice@example.com"})
    assert r.status_code == 202

    # Token is in DB
    token_row = db.scalar(
        select(EmailToken).where(EmailToken.user_id == user.id, EmailToken.purpose == "reset")
    )
    assert token_row is not None

    # We can't read the raw token (only the hash is stored). Insert a known one for the test.
    raw = "reset-raw-token-xyz"
    db.add(EmailToken(
        user_id=user.id, purpose="reset",
        token_hash=hashlib.sha256(raw.encode()).hexdigest(),
        expires_at=dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=10),
    ))
    db.commit()

    r = await client.post("/api/v1/auth/reset-password",
                          json={"token": raw, "new_password": "new-pw-pw-pw"})
    assert r.status_code == 200

    # Login with new password works
    r = await client.post("/api/v1/auth/login",
                          json={"email": "alice@example.com", "password": "new-pw-pw-pw"})
    assert r.status_code == 200


async def test_password_reset_for_unknown_email_returns_202(client):
    """Must not leak whether the email exists."""
    r = await client.post("/api/v1/auth/request-password-reset",
                          json={"email": "noone@example.com"})
    assert r.status_code == 202


async def test_login_with_wrong_password_rejected(client, make_user):
    make_user("bob@example.com", password="correct-horse-battery-staple")
    r = await client.post("/api/v1/auth/login",
                          json={"email": "bob@example.com", "password": "wrong"})
    assert r.status_code == 401


async def test_login_for_inactive_user_rejected(client, db, make_user):
    user = make_user("disabled@example.com", password="pw-pw-pw-pw")
    user.is_active = False
    db.commit()
    r = await client.post("/api/v1/auth/login",
                          json={"email": "disabled@example.com", "password": "pw-pw-pw-pw"})
    assert r.status_code == 401


async def test_register_duplicate_email_rejected(client, make_user):
    make_user("dup@example.com")
    r = await client.post("/api/v1/auth/register",
                          json={"email": "dup@example.com", "password": "pw-pw-pw-pw"})
    assert r.status_code == 409


async def test_register_short_password_rejected(client):
    r = await client.post("/api/v1/auth/register",
                          json={"email": "x@example.com", "password": "short"})
    assert r.status_code == 422


async def test_me_requires_auth(client):
    r = await client.get("/api/v1/auth/me")
    assert r.status_code == 401


async def test_me_returns_current_user(client, make_user, auth_cookie):
    user = make_user("alice@example.com")
    r = await client.get("/api/v1/auth/me", cookies=auth_cookie(str(user.id)))
    assert r.status_code == 200
    assert r.json()["email"] == "alice@example.com"
    assert r.json()["email_verified"] is True
