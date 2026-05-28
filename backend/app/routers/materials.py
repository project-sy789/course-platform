"""Lesson materials — downloadable supplementary files with per-user watermarks.

Two surfaces:
  * Admin: upload / list / delete materials for a lesson.
  * Student: list materials for a lesson they're enrolled in, and download
    files individually. Each download is watermarked with the requesting
    user's identifier (visible footer + invisible PDF metadata for PDFs;
    filename annotation for non-PDFs) and audited in `material_download_logs`.

Why route downloads through the API instead of pre-signed R2 URLs:
the watermarking step needs to run per-request, and we want to log every
download. Caching is fine — the original file is in R2; we just stamp on
the way out.
"""
from __future__ import annotations

import hashlib
import uuid

from fastapi import (
    APIRouter, Depends, File, HTTPException, Request, Response, UploadFile, status,
)
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_session
from ..deps import current_admin, current_user, require_enrollment_for_video
from ..logging import log
from ..models import Lesson, LessonMaterial, MaterialDownloadLog, User
from ..models import Course, Enrollment
import datetime as dt
from ..r2 import delete_object, get_bytes, upload_bytes
from ..watermark import (
    new_watermark_id,
    safe_filename_with_user,
    watermark_pdf,
)

router = APIRouter(prefix="/api/v1", tags=["materials"])

# Loose maximum to keep memory bounded — bumps require ops review.
MAX_MATERIAL_BYTES = 50 * 1024 * 1024  # 50 MB


# ---------- Admin: upload / list / delete ----------

@router.post("/admin/lessons/{lesson_id}/materials", status_code=201)
async def admin_upload_material(
    lesson_id: str,
    file: UploadFile = File(...),
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    lesson = db.get(Lesson, lesson_id)
    if not lesson:
        raise HTTPException(404, "lesson not found")
    if not file.filename:
        raise HTTPException(400, "missing filename")

    data = await file.read(MAX_MATERIAL_BYTES + 1)
    if len(data) > MAX_MATERIAL_BYTES:
        raise HTTPException(413, f"file exceeds {MAX_MATERIAL_BYTES} bytes")

    safe_leaf = file.filename.replace("/", "_").replace("\\", "_")
    material_id = uuid.uuid4()
    r2_key = f"materials/{lesson.id}/{material_id}/{safe_leaf}"
    upload_bytes(r2_key, data, file.content_type or "application/octet-stream")

    row = LessonMaterial(
        id=material_id,
        lesson_id=lesson.id,
        filename=safe_leaf,
        content_type=file.content_type or "application/octet-stream",
        size_bytes=len(data),
        r2_key=r2_key,
    )
    db.add(row); db.commit()
    return {
        "id": str(row.id),
        "filename": row.filename,
        "size_bytes": row.size_bytes,
        "content_type": row.content_type,
    }


@router.get("/admin/lessons/{lesson_id}/materials")
def admin_list_materials(
    lesson_id: str,
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    rows = db.scalars(
        select(LessonMaterial)
        .where(LessonMaterial.lesson_id == lesson_id)
        .order_by(LessonMaterial.created_at.asc())
    ).all()
    return [
        {
            "id": str(r.id),
            "filename": r.filename,
            "content_type": r.content_type,
            "size_bytes": r.size_bytes,
            "created_at": r.created_at.isoformat(),
        } for r in rows
    ]


@router.delete("/admin/materials/{material_id}")
def admin_delete_material(
    material_id: str,
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    row = db.get(LessonMaterial, material_id)
    if not row:
        raise HTTPException(404, "not found")
    try:
        delete_object(row.r2_key)
    except Exception:
        # Don't block DB cleanup if R2 already lost the object.
        log.warning("material_r2_delete_failed", r2_key=row.r2_key)
    db.delete(row); db.commit()
    return {"ok": True}


@router.get("/admin/material-downloads/{watermark_id}")
def admin_lookup_watermark(
    watermark_id: str,
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    """Given a watermark id pulled out of a leaked file, find the download
    that produced it. This is the whole point of the watermark."""
    row = db.scalar(
        select(MaterialDownloadLog).where(MaterialDownloadLog.watermark_id == watermark_id)
    )
    if not row:
        raise HTTPException(404, "no download with that watermark id")
    mat = db.get(LessonMaterial, row.material_id)
    user = db.get(User, row.user_id) if row.user_id else None
    return {
        "watermark_id": row.watermark_id,
        "downloaded_at": row.created_at.isoformat(),
        "ip": str(row.ip) if row.ip else None,
        "user_agent": row.user_agent,
        "user": {"id": str(user.id), "email": user.email} if user else None,
        "material": {
            "id": str(mat.id), "filename": mat.filename, "lesson_id": str(mat.lesson_id),
        } if mat else None,
    }


# ---------- Student: list + download ----------

@router.get("/lessons/{lesson_id}/materials")
def list_materials(
    lesson_id: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
):
    lesson = db.get(Lesson, lesson_id)
    if not lesson:
        raise HTTPException(404, "lesson not found")
    # Same access rule as the video itself: preview lessons are open to any
    # logged-in user; everything else requires an enrollment.
    require_enrollment_for_video(str(lesson.video_id), user, db)

    rows = db.scalars(
        select(LessonMaterial)
        .where(LessonMaterial.lesson_id == lesson_id)
        .order_by(LessonMaterial.created_at.asc())
    ).all()
    return [
        {
            "id": str(r.id),
            "filename": r.filename,
            "content_type": r.content_type,
            "size_bytes": r.size_bytes,
        } for r in rows
    ]


def _client_ctx(request: Request) -> tuple[str, str]:
    ip = request.headers.get("x-real-ip") or (
        request.client.host if request.client else "0.0.0.0"
    )
    ua = request.headers.get("user-agent", "")[:512]
    return ip, ua


@router.get("/materials/{material_id}/download")
def download_material(
    material_id: str,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
):
    """Serve a material with per-user watermark + audit log entry.

    For PDF: visible per-page footer + diagonal stamp + invisible PDF metadata.
    For other types: filename annotated with watermark id; provenance stored
    in the audit log so we can still tie a leak back to a user.
    """
    row = db.get(LessonMaterial, material_id)
    if not row:
        raise HTTPException(404, "not found")
    if row.lesson_id is not None:
        lesson = db.get(Lesson, row.lesson_id)
        if not lesson:
            raise HTTPException(404, "lesson missing")
        require_enrollment_for_video(str(lesson.video_id), user, db)
    else:
        # Course-scoped material: gate on an active enrollment for the course.
        _require_active_enrollment(row.course_id, user, db)

    raw = get_bytes(row.r2_key)
    watermark_id = new_watermark_id()

    if (row.content_type or "").lower() == "application/pdf" or row.filename.lower().endswith(".pdf"):
        try:
            body = watermark_pdf(
                raw, user_id=str(user.id), user_email=user.email,
                watermark_id=watermark_id,
            )
            content_type = "application/pdf"
        except Exception as e:
            # Don't fail the download just because watermarking blew up — log
            # loudly and fall back to the original. Audit row still records
            # who got it.
            log.exception("pdf_watermark_failed", material_id=material_id, error=str(e))
            body = raw
            content_type = row.content_type or "application/pdf"
    else:
        # Non-PDF: we can't reliably stamp arbitrary formats inline. The
        # filename + audit-log row carry attribution.
        body = raw
        content_type = row.content_type or "application/octet-stream"

    ip, ua = _client_ctx(request)
    db.add(MaterialDownloadLog(
        user_id=user.id, material_id=row.id, watermark_id=watermark_id,
        ip=ip, user_agent=ua,
    ))
    db.commit()

    log.info(
        "material_download",
        material_id=material_id,
        target_user_id=str(user.id),
        watermark_id=watermark_id,
        body_sha256=hashlib.sha256(body).hexdigest()[:16],
    )

    out_name = safe_filename_with_user(row.filename, watermark_id)
    return Response(
        content=body,
        media_type=content_type,
        headers={
            "Content-Disposition": f'attachment; filename="{out_name}"',
            "Cache-Control": "no-store, private",
            "X-Watermark-Id": watermark_id,
        },
    )


# ---------- Course-scoped materials ----------
# Same `lesson_materials` table; row distinguished by which scope column
# is set (CHECK constraint on the table makes that exactly-one).

def _require_active_enrollment(course_id, user: User, db: Session) -> Course:
    course = db.get(Course, course_id) if course_id else None
    if not course:
        raise HTTPException(404, "course not found")
    now = dt.datetime.now(dt.timezone.utc)
    enr = db.scalar(
        select(Enrollment).where(
            Enrollment.user_id == user.id,
            Enrollment.course_id == course.id,
        )
    )
    if not enr:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "not enrolled")
    if enr.expires_at is not None and enr.expires_at <= now:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "enrollment expired")
    return course


@router.post("/admin/courses/{slug}/materials", status_code=201)
async def admin_upload_course_material(
    slug: str,
    file: UploadFile = File(...),
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    course = db.scalar(select(Course).where(Course.slug == slug))
    if not course:
        raise HTTPException(404, "course not found")
    if not file.filename:
        raise HTTPException(400, "missing filename")

    data = await file.read(MAX_MATERIAL_BYTES + 1)
    if len(data) > MAX_MATERIAL_BYTES:
        raise HTTPException(413, f"file exceeds {MAX_MATERIAL_BYTES} bytes")

    safe_leaf = file.filename.replace("/", "_").replace("\\", "_")
    material_id = uuid.uuid4()
    r2_key = f"course-materials/{course.id}/{material_id}/{safe_leaf}"
    upload_bytes(r2_key, data, file.content_type or "application/octet-stream")

    row = LessonMaterial(
        id=material_id,
        course_id=course.id,
        filename=safe_leaf,
        content_type=file.content_type or "application/octet-stream",
        size_bytes=len(data),
        r2_key=r2_key,
    )
    db.add(row); db.commit()
    return {
        "id": str(row.id),
        "filename": row.filename,
        "size_bytes": row.size_bytes,
        "content_type": row.content_type,
    }


@router.get("/admin/courses/{slug}/materials")
def admin_list_course_materials(
    slug: str,
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    course = db.scalar(select(Course).where(Course.slug == slug))
    if not course:
        raise HTTPException(404, "course not found")
    rows = db.scalars(
        select(LessonMaterial)
        .where(LessonMaterial.course_id == course.id)
        .order_by(LessonMaterial.created_at.asc())
    ).all()
    return [
        {
            "id": str(r.id),
            "filename": r.filename,
            "content_type": r.content_type,
            "size_bytes": r.size_bytes,
            "created_at": r.created_at.isoformat(),
        } for r in rows
    ]


@router.get("/courses/{slug}/materials")
def list_course_materials(
    slug: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
):
    course = db.scalar(select(Course).where(Course.slug == slug))
    if not course:
        raise HTTPException(404, "course not found")
    _require_active_enrollment(course.id, user, db)
    rows = db.scalars(
        select(LessonMaterial)
        .where(LessonMaterial.course_id == course.id)
        .order_by(LessonMaterial.created_at.asc())
    ).all()
    return [
        {
            "id": str(r.id),
            "filename": r.filename,
            "content_type": r.content_type,
            "size_bytes": r.size_bytes,
        } for r in rows
    ]
