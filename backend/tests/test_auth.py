"""Auth flow tests."""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio


async def test_register_then_login(client):
    r = await client.post("/api/v1/auth/register",
                          json={"email": "alice@example.com", "password": "pw-pw-pw-pw"})
    assert r.status_code == 201

    r = await client.post("/api/v1/auth/login",
                          json={"email": "alice@example.com", "password": "pw-pw-pw-pw"})
    assert r.status_code == 200
    assert r.cookies.get("session")


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
