"""Tests for lesson materials + per-user watermarking.

R2 is monkey-patched to an in-memory dict so we don't need creds in CI.
The watermark module itself runs unmodified — these tests verify the
download path actually stamps the file and the audit log records the
mapping.
"""
from __future__ import annotations

import io

import pytest
from sqlalchemy import select

from app.models import Lesson, LessonMaterial, MaterialDownloadLog
from app.routers import materials as materials_router

pytestmark = pytest.mark.asyncio


@pytest.fixture
def fake_r2(monkeypatch):
    """Replace R2 with an in-memory dict shared across the materials router."""
    store: dict[str, bytes] = {}

    def _upload(key: str, data: bytes, content_type: str) -> None:
        store[key] = data

    def _get(key: str) -> bytes:
        if key not in store:
            raise KeyError(key)
        return store[key]

    def _delete(key: str) -> None:
        store.pop(key, None)

    monkeypatch.setattr(materials_router, "upload_bytes", _upload)
    monkeypatch.setattr(materials_router, "get_bytes", _get)
    monkeypatch.setattr(materials_router, "delete_object", _delete)
    return store


def _tiny_pdf() -> bytes:
    """A minimal valid PDF — pypdf accepts this as a parseable document."""
    from reportlab.pdfgen import canvas
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.drawString(72, 720, "Original lesson slide")
    c.showPage()
    c.save()
    return buf.getvalue()


async def test_admin_only_can_upload(
    client, db, make_user, make_video_with_key, auth_cookie, fake_r2
):
    student = make_user("s@example.com")
    video, _ = make_video_with_key()
    lesson = db.scalar(select(Lesson).where(Lesson.video_id == video.id))

    files = {"file": ("a.txt", b"hello", "text/plain")}
    r = await client.post(
        f"/api/v1/admin/lessons/{lesson.id}/materials",
        cookies=auth_cookie(str(student.id)), files=files,
    )
    assert r.status_code == 403


async def test_admin_upload_then_student_download_watermarks_pdf(
    client, db, make_user, make_video_with_key, enroll, auth_cookie, fake_r2
):
    admin = make_user("a@example.com", is_admin=True)
    student = make_user("alice@example.com")
    video, _ = make_video_with_key()
    lesson = db.scalar(select(Lesson).where(Lesson.video_id == video.id))
    enroll(student, lesson.course_id)

    pdf_bytes = _tiny_pdf()
    files = {"file": ("slides.pdf", pdf_bytes, "application/pdf")}
    r = await client.post(
        f"/api/v1/admin/lessons/{lesson.id}/materials",
        cookies=auth_cookie(str(admin.id)), files=files,
    )
    assert r.status_code == 201
    material_id = r.json()["id"]

    # Student lists materials
    r = await client.get(
        f"/api/v1/lessons/{lesson.id}/materials",
        cookies=auth_cookie(str(student.id)),
    )
    assert r.status_code == 200
    assert any(m["id"] == material_id for m in r.json())

    # Student downloads — should be a watermarked PDF
    r = await client.get(
        f"/api/v1/materials/{material_id}/download",
        cookies=auth_cookie(str(student.id)),
        headers={"X-Real-IP": "10.0.0.5", "User-Agent": "browser/1"},
    )
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    watermark_id = r.headers["x-watermark-id"]
    assert watermark_id

    # Filename carries the watermark id
    assert f"id-{watermark_id}" in r.headers["content-disposition"]

    # PDF metadata contains the user identifier — even if visible footer
    # is cropped, opening File > Properties reveals the source.
    from pypdf import PdfReader
    out_pdf = PdfReader(io.BytesIO(r.content))
    meta = dict(out_pdf.metadata or {})
    assert meta.get("/WatermarkUserEmail") == "alice@example.com"
    assert meta.get("/WatermarkId") == watermark_id

    # Audit log records the user/material mapping
    log = db.scalar(
        select(MaterialDownloadLog).where(MaterialDownloadLog.watermark_id == watermark_id)
    )
    assert log is not None
    assert str(log.user_id) == str(student.id)
    assert str(log.material_id) == material_id


async def test_unenrolled_student_cannot_download(
    client, db, make_user, make_video_with_key, auth_cookie, fake_r2
):
    admin = make_user("a@example.com", is_admin=True)
    student = make_user("eve@example.com")  # not enrolled
    video, _ = make_video_with_key()
    lesson = db.scalar(select(Lesson).where(Lesson.video_id == video.id))

    files = {"file": ("a.pdf", _tiny_pdf(), "application/pdf")}
    r = await client.post(
        f"/api/v1/admin/lessons/{lesson.id}/materials",
        cookies=auth_cookie(str(admin.id)), files=files,
    )
    material_id = r.json()["id"]

    r = await client.get(
        f"/api/v1/materials/{material_id}/download",
        cookies=auth_cookie(str(student.id)),
    )
    assert r.status_code == 403


async def test_admin_lookup_watermark_resolves_to_user(
    client, db, make_user, make_video_with_key, enroll, auth_cookie, fake_r2
):
    admin = make_user("a@example.com", is_admin=True)
    student = make_user("alice@example.com")
    video, _ = make_video_with_key()
    lesson = db.scalar(select(Lesson).where(Lesson.video_id == video.id))
    enroll(student, lesson.course_id)

    files = {"file": ("doc.pdf", _tiny_pdf(), "application/pdf")}
    r = await client.post(
        f"/api/v1/admin/lessons/{lesson.id}/materials",
        cookies=auth_cookie(str(admin.id)), files=files,
    )
    material_id = r.json()["id"]
    r = await client.get(
        f"/api/v1/materials/{material_id}/download",
        cookies=auth_cookie(str(student.id)),
    )
    wm = r.headers["x-watermark-id"]

    r = await client.get(
        f"/api/v1/admin/material-downloads/{wm}",
        cookies=auth_cookie(str(admin.id)),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["email"] == "alice@example.com"
    assert body["material"]["filename"] == "doc.pdf"


async def test_non_pdf_material_served_as_is_with_audit(
    client, db, make_user, make_video_with_key, enroll, auth_cookie, fake_r2
):
    admin = make_user("a@example.com", is_admin=True)
    student = make_user("s@example.com")
    video, _ = make_video_with_key()
    lesson = db.scalar(select(Lesson).where(Lesson.video_id == video.id))
    enroll(student, lesson.course_id)

    payload = b"print('hello')\n"
    files = {"file": ("snippet.py", payload, "text/x-python")}
    r = await client.post(
        f"/api/v1/admin/lessons/{lesson.id}/materials",
        cookies=auth_cookie(str(admin.id)), files=files,
    )
    material_id = r.json()["id"]

    r = await client.get(
        f"/api/v1/materials/{material_id}/download",
        cookies=auth_cookie(str(student.id)),
    )
    assert r.status_code == 200
    assert r.content == payload
    assert "id-" in r.headers["content-disposition"]
    assert r.headers["x-watermark-id"]


async def test_oversized_upload_rejected(
    client, db, make_user, make_video_with_key, auth_cookie, fake_r2, monkeypatch
):
    monkeypatch.setattr(materials_router, "MAX_MATERIAL_BYTES", 16)
    admin = make_user("a@example.com", is_admin=True)
    video, _ = make_video_with_key()
    lesson = db.scalar(select(Lesson).where(Lesson.video_id == video.id))

    files = {"file": ("big.bin", b"x" * 100, "application/octet-stream")}
    r = await client.post(
        f"/api/v1/admin/lessons/{lesson.id}/materials",
        cookies=auth_cookie(str(admin.id)), files=files,
    )
    assert r.status_code == 413
