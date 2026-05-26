"""Health endpoint tests."""
import pytest

pytestmark = pytest.mark.asyncio


async def test_liveness(client):
    r = await client.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


async def test_readiness_ok(client):
    r = await client.get("/healthz/ready")
    assert r.status_code == 200
    body = r.json()
    assert body["checks"]["db"] == "ok"
    assert body["checks"]["redis"] == "ok"
