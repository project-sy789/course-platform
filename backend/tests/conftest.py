"""Test fixtures.

These tests run against the docker postgres but on a separate database
(`course_test`). Set TEST_DATABASE_URL to override; otherwise the conftest
derives it from DATABASE_URL by swapping the database name.

Run from inside the api container:

  docker compose exec api pip install -r requirements-dev.txt
  docker compose exec -e TEST_DATABASE_URL=postgresql+psycopg://course:$DB_PASSWORD@db:5432/course_test \\
    api bash -c "createdb -U course -h db course_test 2>/dev/null; pytest"
"""
from __future__ import annotations

import asyncio
import os
import secrets
import base64

# Set test secrets BEFORE app modules load (Settings reads env at import time)
os.environ.setdefault("JWT_SECRET", secrets.token_hex(32))
os.environ.setdefault("KEK_BASE64", base64.b64encode(secrets.token_bytes(32)).decode())
os.environ.setdefault("R2_PUBLIC_BASE", "https://media.test.example.com")
os.environ.setdefault("CORS_ORIGINS", "http://localhost:3000")
# Anti-sharing forces OTP on every login. Most fixture-based tests inject
# auth via auth_cookie() and never touch /login, so we default it off here.
# Dedicated tests in test_anti_sharing.py flip settings.ANTI_SHARING_ENABLED
# back on at runtime to exercise the OTP path.
os.environ.setdefault("ANTI_SHARING_ENABLED", "false")

if "TEST_DATABASE_URL" in os.environ:
    os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]

import pytest
import fakeredis.aioredis
from httpx import AsyncClient, ASGITransport
from sqlalchemy import create_engine

from app.main import app
from app.db import SessionLocal, engine, get_redis
from app.models import Base, User, Course, Video, Lesson, VideoKey, Enrollment
from app.crypto import encrypt_video_key
from app.auth import hash_password, create_jwt


@pytest.fixture(scope="session", autouse=True)
def _create_schema():
    """Create the schema once per test session."""
    # citext + pgcrypto extensions are required by columns/server defaults
    with engine.begin() as conn:
        from sqlalchemy import text
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS citext"))
        conn.execute(text('CREATE EXTENSION IF NOT EXISTS "pgcrypto"'))
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture
def db():
    s = SessionLocal()
    try:
        yield s
    finally:
        s.rollback()
        # Truncate tables between tests to keep them isolated.
        with engine.begin() as conn:
            for table in reversed(Base.metadata.sorted_tables):
                conn.exec_driver_sql(f'TRUNCATE TABLE "{table.name}" CASCADE')
        s.close()


@pytest.fixture
def fake_redis():
    return fakeredis.aioredis.FakeRedis(decode_responses=True)


@pytest.fixture
async def client(fake_redis):
    async def _override():
        return fake_redis
    app.dependency_overrides[get_redis] = _override
    # AbuseGuardMiddleware calls get_redis_singleton() directly (not via
    # Depends), so we also redirect that to the fakeredis for the duration
    # of the test.
    from app import db as _db
    real_singleton = _db.get_redis_singleton
    _db.get_redis_singleton = lambda: fake_redis  # type: ignore
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c
    _db.get_redis_singleton = real_singleton  # type: ignore
    app.dependency_overrides.clear()


# ---------- Factories ----------

@pytest.fixture
def make_user(db):
    def _make(email: str = "u@example.com", password: str = "pw-pw-pw-pw",
              is_admin: bool = False, email_verified: bool = True):
        u = User(email=email, password_hash=hash_password(password),
                 is_admin=is_admin, email_verified=email_verified)
        db.add(u); db.commit()
        return u
    return _make


@pytest.fixture
def make_video_with_key(db):
    def _make(course_slug: str = "intro", lesson_title: str = "Welcome", is_preview: bool = False):
        course = Course(slug=course_slug, title=lesson_title)
        db.add(course); db.flush()
        video = Video(r2_manifest_key=f"courses/{course_slug}/lessons/x/master.m3u8")
        db.add(video); db.flush()
        lesson = Lesson(course_id=course.id, video_id=video.id, title=lesson_title,
                        position=1, is_preview=is_preview)
        db.add(lesson)
        plaintext = secrets.token_bytes(16)
        ct, nonce, tag = encrypt_video_key(plaintext)
        db.add(VideoKey(video_id=video.id, key_ciphertext=ct, key_nonce=nonce, key_tag=tag))
        db.commit()
        return video, plaintext
    return _make


@pytest.fixture
def enroll(db):
    def _enroll(user, course_id):
        e = Enrollment(user_id=user.id, course_id=course_id)
        db.add(e); db.commit()
        return e
    return _enroll


@pytest.fixture
def auth_cookie():
    """Build a valid session cookie value for a user id."""
    def _make(user_id: str) -> dict[str, str]:
        return {"session": create_jwt(user_id)}
    return _make
