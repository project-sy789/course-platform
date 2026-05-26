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
from ..deps import current_admin, compute_enrollment_expiry
from ..models import (
    User, Course, Lesson, Video, VideoKey, Enrollment, KeyAccessLog, EncodeJob,
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
    enr = Enrollment(
        user_id=user.id,
        course_id=course.id,
        expires_at=compute_enrollment_expiry(course),
    )
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


# ---------- Per-lesson entitlements (ขายแยกรายบท) ----------

class GrantLessonEntitlement(BaseModel):
    user_email: EmailStr
    lesson_id: str
    # Optional: limit access to N days from now. None = lifetime.
    duration_days: Optional[int] = None


@router.post("/lesson-entitlements")
def grant_lesson_entitlement(
    body: GrantLessonEntitlement,
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    from ..models import Lesson, LessonEntitlement
    user = db.scalar(select(User).where(User.email == body.user_email))
    lesson = db.get(Lesson, body.lesson_id)
    if not user or not lesson:
        raise HTTPException(404, "user or lesson not found")
    existing = db.scalar(
        select(LessonEntitlement).where(
            LessonEntitlement.user_id == user.id,
            LessonEntitlement.lesson_id == lesson.id,
        )
    )
    if existing:
        return {"id": str(existing.id), "status": "already_entitled"}
    expires_at = None
    if body.duration_days and body.duration_days > 0:
        expires_at = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=body.duration_days)
    ent = LessonEntitlement(user_id=user.id, lesson_id=lesson.id, expires_at=expires_at)
    db.add(ent); db.commit()
    return {"id": str(ent.id), "status": "created"}


@router.delete("/lesson-entitlements/{entitlement_id}")
def revoke_lesson_entitlement(
    entitlement_id: str,
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    from ..models import LessonEntitlement
    ent = db.get(LessonEntitlement, entitlement_id)
    if not ent:
        raise HTTPException(404, "not found")
    db.delete(ent); db.commit()
    return {"ok": True}


# ---------- Courses ----------

class CourseIn(BaseModel):
    slug: str
    title: str
    description: Optional[str] = None
    price_cents: int = 0
    # None = lifetime (ขายขาด). Positive int = days of access from enrollment.
    access_duration_days: Optional[int] = None


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


@router.get("/courses")
def admin_list_courses(
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    rows = db.scalars(select(Course).order_by(Course.created_at.desc())).all()
    return [
        {
            "id": str(c.id), "slug": c.slug, "title": c.title,
            "description": c.description, "price_cents": c.price_cents,
            "access_duration_days": c.access_duration_days,
            "created_at": c.created_at.isoformat(),
        } for c in rows
    ]


class CoursePatch(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    price_cents: Optional[int] = None
    # Use Pydantic's explicit-None semantics — caller can clear duration by
    # passing null to make a course lifetime again.
    access_duration_days: Optional[int] = None


@router.patch("/courses/{slug}")
def update_course(
    slug: str,
    body: CoursePatch,
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    course = db.scalar(select(Course).where(Course.slug == slug))
    if not course:
        raise HTTPException(404, "not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(course, k, v)
    db.commit()
    return {"ok": True}


@router.delete("/courses/{slug}")
def delete_course(
    slug: str,
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    course = db.scalar(select(Course).where(Course.slug == slug))
    if not course:
        raise HTTPException(404, "not found")
    # Refuse if anyone is enrolled — force admin to revoke first, otherwise
    # you silently destroy paid access.
    enr_count = db.scalar(
        select(func.count()).select_from(Enrollment).where(Enrollment.course_id == course.id)
    ) or 0
    if enr_count > 0:
        raise HTTPException(409, f"course has {enr_count} active enrollments — revoke first")
    db.delete(course); db.commit()
    return {"ok": True}


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


# ---------- System settings (read-only inspector) ----------
# Surfaces which integrations are wired up so admins can confirm the deploy
# without SSH. Sensitive values (keys, passwords) are NEVER returned in full —
# only their presence + last 4 chars to confirm what's loaded.

def _mask(v: str) -> str:
    if not v:
        return ""
    if len(v) <= 4:
        return "****"
    return f"****{v[-4:]}"


@router.get("/settings")
def get_settings(_: User = Depends(current_admin)):
    return {
        "email": {
            "smtp_host": settings.SMTP_HOST,
            "smtp_port": settings.SMTP_PORT,
            "smtp_use_tls": settings.SMTP_USE_TLS,
            "smtp_user": settings.SMTP_USER or None,
            "smtp_password_set": bool(settings.SMTP_PASSWORD),
            "smtp_from": settings.SMTP_FROM,
            "frontend_url": settings.FRONTEND_URL,
        },
        "storage": {
            "r2_account_id_tail": _mask(settings.R2_ACCOUNT_ID),
            "r2_bucket": settings.R2_BUCKET or None,
            "r2_public_base": settings.R2_PUBLIC_BASE,
            "r2_creds_set": bool(settings.R2_ACCESS_KEY_ID and settings.R2_SECRET_ACCESS_KEY),
        },
        "backup": {
            "aws_region": settings.AWS_REGION,
            "aws_bucket": settings.AWS_BACKUP_BUCKET or None,
            "storage_class": settings.AWS_BACKUP_STORAGE_CLASS,
            "aws_creds_set": bool(settings.AWS_ACCESS_KEY_ID and settings.AWS_SECRET_ACCESS_KEY),
        },
        "payments": {
            "stripe_secret_set": bool(settings.STRIPE_SECRET_KEY),
            "stripe_webhook_set": bool(settings.STRIPE_WEBHOOK_SECRET),
            "currency": settings.STRIPE_CURRENCY,
        },
        "security": {
            "kek_set": bool(settings.KEK_BASE64),
            "jwt_secret_set": bool(settings.JWT_SECRET),
            "jwt_ttl_min": settings.JWT_TTL_MIN,
            "pb_session_ttl_sec": settings.PB_SESSION_TTL_SEC,
            "key_rate_limit_per_min": settings.KEY_RATE_LIMIT_PER_MIN,
            "max_concurrent_sessions": settings.MAX_CONCURRENT_SESSIONS,
            "e2e_bypass_set": bool(settings.E2E_BYPASS_TOKEN),
        },
        "cors_origins": [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()],
    }


class TestEmailBody(BaseModel):
    to: EmailStr


@router.post("/settings/test-email")
async def admin_send_test_email(
    body: TestEmailBody,
    _: User = Depends(current_admin),
):
    """Send a one-shot test email through the configured SMTP relay.

    If SMTP_HOST is empty this is a no-op (logs a warning); useful to confirm
    Postfix → external relay → inbox before going live."""
    from ..email import send_email
    await send_email(
        body.to,
        "ทดสอบระบบส่งอีเมล",
        "นี่คือข้อความทดสอบจาก Course Platform — หากได้รับแสดงว่าระบบ SMTP ทำงานปกติ",
        "<p>นี่คือข้อความทดสอบจาก Course Platform</p>"
        "<p style='color:#888'>หากได้รับแสดงว่าระบบ SMTP ทำงานปกติ</p>",
    )
    return {"ok": True}


# ---------- Background encode jobs ----------
# Admin uploads ONE raw source via /uploads/{id}/file, then POSTs here. The arq
# worker picks it up, runs encode_multibitrate.sh, uploads the ladder to R2,
# and creates the Video/Lesson/VideoKey rows.

class EnqueueEncode(BaseModel):
    upload_id: str
    course_slug: str
    lesson_title: str
    lesson_position: int = 1
    is_preview: bool = False


@router.post("/encode-jobs", status_code=202)
async def enqueue_encode(
    body: EnqueueEncode,
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    upload_dir = os.path.join(_BUFFER_ROOT, body.upload_id)
    if not os.path.isdir(upload_dir):
        raise HTTPException(404, "upload not found")
    if not db.scalar(select(Course).where(Course.slug == body.course_slug)):
        raise HTTPException(404, "course not found — create it first")

    job = EncodeJob(
        upload_id=body.upload_id,
        course_slug=body.course_slug,
        lesson_title=body.lesson_title,
        position=body.lesson_position,
        is_preview=body.is_preview,
    )
    db.add(job); db.commit(); db.refresh(job)

    from arq import create_pool
    from arq.connections import RedisSettings
    pool = await create_pool(RedisSettings.from_dsn(settings.REDIS_URL))
    try:
        await pool.enqueue_job("encode_video", str(job.id))
    finally:
        await pool.close()

    return {"job_id": str(job.id), "status": job.status}


@router.get("/encode-jobs")
def list_encode_jobs(
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
    limit: int = 50,
):
    rows = db.scalars(
        select(EncodeJob).order_by(EncodeJob.created_at.desc()).limit(limit)
    ).all()
    return [
        {
            "id": str(r.id),
            "upload_id": r.upload_id,
            "course_slug": r.course_slug,
            "lesson_title": r.lesson_title,
            "status": r.status,
            "error": r.error,
            "video_id": str(r.video_id) if r.video_id else None,
            "created_at": r.created_at.isoformat(),
            "updated_at": r.updated_at.isoformat(),
        } for r in rows
    ]


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
