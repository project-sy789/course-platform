"""Admin endpoints. All routes require an authenticated admin user.

Upload flow for an HLS asset:
  1. Admin encodes locally with ffmpeg + AES-128 key (key URI placeholder)
  2. Admin POSTs each file to /admin/upload-segment with the same upload_id
  3. Admin POSTs /admin/finalize-upload with key_hex, course_slug, lesson_title, position
     → backend uploads buffered files to R2, registers Course/Video/Lesson/VideoKey

For large files use the chunked upload-segment endpoint, one segment per request.
"""
from __future__ import annotations

import os
import uuid
import datetime as dt
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from ..db import get_session
from ..deps import current_admin
from ..models import (
    User, Course, Lesson, Video, VideoKey, Enrollment, KeyAccessLog,
)
from ..crypto import encrypt_video_key
from ..r2 import upload_bytes
from ..config import settings

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])

# ---------- Stats / dashboard ----------

@router.get("/stats")
def stats(_: User = Depends(current_admin), db: Session = Depends(get_session)):
    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=24)
    return {
        "users": db.scalar(select(func.count()).select_from(User)),
        "courses": db.scalar(select(func.count()).select_from(Course)),
        "lessons": db.scalar(select(func.count()).select_from(Lesson)),
        "enrollments": db.scalar(select(func.count()).select_from(Enrollment)),
        "key_grants_24h": db.scalar(
            select(func.count()).select_from(KeyAccessLog).where(
                KeyAccessLog.granted.is_(True),
                KeyAccessLog.created_at >= cutoff,
            )
        ) or 0,
        "key_denials_24h": db.scalar(
            select(func.count()).select_from(KeyAccessLog).where(
                KeyAccessLog.granted.is_(False),
                KeyAccessLog.created_at >= cutoff,
            )
        ) or 0,
    }


# ---------- Users ----------

@router.get("/users")
def list_users(
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
    limit: int = 100,
):
    rows = db.scalars(select(User).order_by(User.created_at.desc()).limit(limit)).all()
    return [
        {
            "id": str(u.id),
            "email": u.email,
            "is_admin": u.is_admin,
            "is_active": u.is_active,
            "created_at": u.created_at.isoformat(),
        } for u in rows
    ]


class GrantEnrollment(BaseModel):
    user_email: EmailStr
    course_slug: str


@router.post("/enrollments")
def grant_enrollment(
    body: GrantEnrollment,
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    user = db.scalar(select(User).where(User.email == body.user_email))
    course = db.scalar(select(Course).where(Course.slug == body.course_slug))
    if not user or not course:
        raise HTTPException(404, "user or course not found")
    existing = db.scalar(
        select(Enrollment).where(
            Enrollment.user_id == user.id, Enrollment.course_id == course.id
        )
    )
    if existing:
        return {"id": str(existing.id), "status": "already_enrolled"}
    enr = Enrollment(user_id=user.id, course_id=course.id)
    db.add(enr); db.commit()
    return {"id": str(enr.id), "status": "created"}


@router.delete("/enrollments/{enrollment_id}")
def revoke_enrollment(
    enrollment_id: str,
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    enr = db.get(Enrollment, enrollment_id)
    if not enr:
        raise HTTPException(404, "not found")
    db.delete(enr); db.commit()
    return {"ok": True}


# ---------- Courses ----------

class CourseIn(BaseModel):
    slug: str
    title: str
    description: Optional[str] = None
    price_cents: int = 0


@router.post("/courses", status_code=201)
def create_course(
    body: CourseIn,
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    if db.scalar(select(Course).where(Course.slug == body.slug)):
        raise HTTPException(409, "slug taken")
    c = Course(**body.model_dump())
    db.add(c); db.commit()
    return {"id": str(c.id)}


# ---------- Video upload ----------
# Files are buffered in /tmp under a per-upload UUID, then flushed to R2 on finalize.
# This keeps the API stateless from the client's perspective.

_BUFFER_ROOT = "/tmp/course-uploads"


@router.post("/uploads", status_code=201)
def create_upload(_: User = Depends(current_admin)):
    upload_id = str(uuid.uuid4())
    os.makedirs(os.path.join(_BUFFER_ROOT, upload_id), exist_ok=True)
    return {"upload_id": upload_id}


@router.post("/uploads/{upload_id}/file")
async def upload_file(
    upload_id: str,
    filename: str = Form(...),
    relpath: str = Form(""),
    file: UploadFile = File(...),
    _: User = Depends(current_admin),
):
    # filename is just the leaf; relpath is optional subdirectory like "720p"
    if "/" in filename or ".." in filename:
        raise HTTPException(400, "invalid filename")
    if ".." in relpath or relpath.startswith("/"):
        raise HTTPException(400, "invalid relpath")
    upload_dir = os.path.join(_BUFFER_ROOT, upload_id)
    if not os.path.isdir(upload_dir):
        raise HTTPException(404, "upload not found")
    target_dir = os.path.join(upload_dir, relpath) if relpath else upload_dir
    os.makedirs(target_dir, exist_ok=True)
    dest = os.path.join(target_dir, filename)
    with open(dest, "wb") as f:
        while chunk := await file.read(1024 * 1024):
            f.write(chunk)
    return {"ok": True, "size": os.path.getsize(dest)}


class FinalizeUpload(BaseModel):
    upload_id: str
    course_slug: str
    lesson_title: str
    lesson_position: int
    aes_key_hex: str          # 32 hex chars (16 bytes)
    manifest_filename: str = "index.m3u8"
    is_preview: bool = False
    duration_sec: Optional[int] = None


@router.post("/uploads/finalize", status_code=201)
def finalize_upload(
    body: FinalizeUpload,
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    raw_key = bytes.fromhex(body.aes_key_hex)
    if len(raw_key) != 16:
        raise HTTPException(422, "aes_key_hex must decode to 16 bytes")

    upload_dir = os.path.join(_BUFFER_ROOT, body.upload_id)
    if not os.path.isdir(upload_dir):
        raise HTTPException(404, "upload not found")

    # Walk the buffer recursively so multi-bitrate trees (e.g. 360p/, 720p/) are preserved.
    rel_files: list[str] = []
    for root, _dirs, fnames in os.walk(upload_dir):
        for fname in fnames:
            full = os.path.join(root, fname)
            rel = os.path.relpath(full, upload_dir).replace(os.sep, "/")
            rel_files.append(rel)
    rel_files.sort()
    if body.manifest_filename not in rel_files:
        raise HTTPException(422, f"{body.manifest_filename} missing from upload (top-level)")

    course = db.scalar(select(Course).where(Course.slug == body.course_slug))
    if not course:
        raise HTTPException(404, "course not found — create it first")

    # Push every file to R2 under courses/<slug>/lessons/<uuid>/<rel>
    video_id = uuid.uuid4()
    r2_prefix = f"courses/{body.course_slug}/lessons/{video_id}"
    manifest_key = f"{r2_prefix}/{body.manifest_filename}"

    for rel in rel_files:
        with open(os.path.join(upload_dir, rel), "rb") as f:
            data = f.read()
        if rel.endswith(".m3u8"):
            ctype = "application/vnd.apple.mpegurl"
        elif rel.endswith(".ts"):
            ctype = "video/mp2t"
        else:
            ctype = "application/octet-stream"
        upload_bytes(f"{r2_prefix}/{rel}", data, ctype)

    # Register in DB
    video = Video(id=video_id, r2_manifest_key=manifest_key, duration_sec=body.duration_sec)
    db.add(video)
    db.flush()

    lesson = Lesson(
        course_id=course.id,
        video_id=video.id,
        title=body.lesson_title,
        position=body.lesson_position,
        is_preview=body.is_preview,
    )
    db.add(lesson)

    ct, nonce, tag = encrypt_video_key(raw_key)
    db.add(VideoKey(
        video_id=video.id, key_ciphertext=ct, key_nonce=nonce, key_tag=tag,
    ))
    db.commit()

    # Cleanup buffer (recursive)
    import shutil
    shutil.rmtree(upload_dir, ignore_errors=True)

    return {
        "video_id": str(video.id),
        "lesson_id": str(lesson.id),
        "manifest_url": f"{settings.R2_PUBLIC_BASE}/{manifest_key}",
    }


# ---------- Key access logs ----------

@router.get("/logs")
def access_logs(
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
    limit: int = 200,
    granted: Optional[bool] = None,
    user_id: Optional[str] = None,
    video_id: Optional[str] = None,
):
    q = select(KeyAccessLog).order_by(KeyAccessLog.created_at.desc()).limit(limit)
    if granted is not None:
        q = q.where(KeyAccessLog.granted.is_(granted))
    if user_id:
        q = q.where(KeyAccessLog.user_id == user_id)
    if video_id:
        q = q.where(KeyAccessLog.video_id == video_id)
    rows = db.scalars(q).all()
    return [
        {
            "id": r.id,
            "user_id": str(r.user_id) if r.user_id else None,
            "video_id": str(r.video_id),
            "ip": str(r.ip),
            "user_agent": r.user_agent,
            "granted": r.granted,
            "reason": r.reason,
            "created_at": r.created_at.isoformat(),
        } for r in rows
    ]
