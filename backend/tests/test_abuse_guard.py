"""Tests for AbuseGuardMiddleware — IP-level pattern-based rate limit / ban."""
from __future__ import annotations

import pytest
from app import abuse_guard

pytestmark = pytest.mark.asyncio


async def test_under_limit_passes(client):
    # /healthz is excluded; hit /api/v1/auth/me unauthenticated which is
    # covered by the "auth" rule and returns 401. We only care that the
    # middleware lets the request through (i.e. NOT 429).
    r = await client.get("/api/v1/auth/me")
    assert r.status_code != 429


async def test_over_limit_triggers_ban(client, fake_redis, monkeypatch):
    # Shrink the auth rule so the test isn't 30+ round-trips.
    test_rules = (
        abuse_guard.Rule("auth_test", "/api/v1/auth/", window_sec=60,
                         limit=3, ban_sec=60),
        abuse_guard.Rule("all", "/api/v1/", window_sec=60, limit=600, ban_sec=300),
    )
    monkeypatch.setattr(abuse_guard, "RULES", test_rules)

    headers = {"X-Real-IP": "203.0.113.7"}
    # 3 hits stay under, 4th trips the rule and bans.
    for _ in range(3):
        r = await client.get("/api/v1/auth/me", headers=headers)
        assert r.status_code != 429
    r = await client.get("/api/v1/auth/me", headers=headers)
    assert r.status_code == 429
    assert "Retry-After" in r.headers

    # Subsequent requests from the banned IP are blocked outright.
    r2 = await client.get("/api/v1/auth/me", headers=headers)
    assert r2.status_code == 429
    # ...but a different IP is unaffected.
    r3 = await client.get(
        "/api/v1/auth/me", headers={"X-Real-IP": "203.0.113.8"},
    )
    assert r3.status_code != 429


async def test_excluded_paths_never_banned(client, monkeypatch):
    # Even with a 1-request limit, /healthz must keep responding.
    test_rules = (
        abuse_guard.Rule("all", "/api/v1/", window_sec=60, limit=1, ban_sec=60),
    )
    monkeypatch.setattr(abuse_guard, "RULES", test_rules)
    headers = {"X-Real-IP": "203.0.113.9"}
    for _ in range(5):
        r = await client.get("/healthz", headers=headers)
        assert r.status_code == 200
