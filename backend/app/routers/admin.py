"""Admin endpoints. All routes require an authenticated admin user.

Upload flow for an HLS asset:
  1. Admin encodes locally with ffmpeg + AES-128 key (key URI placeholder)
  2. Admin POSTs each file to /admin/upload-segment with the same upload_id
  3. Admin POSTs /admin/finalize-upload with key_hex, course_slug, lesson_title, position
     → backend uploads buffered files to R2, registers Course/Video/Lesson/VideoKey

For large files use the chunked upload-segment endpoint, one segment per request.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import os
import secrets
import time
import uuid
import datetime as dt
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, EmailStr
from redis.asyncio import Redis
from sqlalchemy import delete as sa_delete, select, func
from sqlalchemy.orm import Session

from ..db import get_session, get_redis
from ..deps import current_admin, compute_enrollment_expiry
from ..models import (
    AdminAuditLog, Coupon, CouponRedemption, Course, EmailToken, EncodeJob, Enrollment,
    KeyAccessLog, Lesson, LessonEntitlement, LoginEvent, Order, OrderItem, Payment,
    SlipUpload, TrustedDevice, User, Video, VideoKey,
)
from ..audit import record as audit_record
from ..crypto import encrypt_video_key
from ..r2 import upload_bytes, presigned_get_url, delete_object
from ..config import settings
from .slips import materialize_approval

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
    price_baht: int = 0
    # None = lifetime (ขายขาด). Positive int = days of access from enrollment.
    access_duration_days: Optional[int] = None
    # Opt-in pixel watermark (canvas-rendered). Heavy on CPU/battery —
    # only flip on for high-value courses.
    pixel_watermark: bool = False
    is_featured: bool = False


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
            "description": c.description, "price_baht": c.price_baht,
            "access_duration_days": c.access_duration_days,
            "pixel_watermark": c.pixel_watermark,
            "is_featured": c.is_featured,
            "cover_url": f"/api/v1/courses/{c.slug}/cover" if c.cover_image_key else None,
            "created_at": c.created_at.isoformat(),
        } for c in rows
    ]


class CoursePatch(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    price_baht: Optional[int] = None
    # Use Pydantic's explicit-None semantics — caller can clear duration by
    # passing null to make a course lifetime again.
    access_duration_days: Optional[int] = None
    pixel_watermark: Optional[bool] = None
    is_featured: Optional[bool] = None


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


# ---------- Course cover image ----------

_COVER_MAX_BYTES = 5 * 1024 * 1024  # 5 MB
_COVER_TYPES = {"image/jpeg", "image/png", "image/webp"}


@router.post("/courses/{slug}/cover", status_code=201)
async def upload_course_cover(
    slug: str,
    file: UploadFile = File(...),
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    course = db.scalar(select(Course).where(Course.slug == slug))
    if not course:
        raise HTTPException(404, "course not found")
    ctype = (file.content_type or "").lower()
    if ctype not in _COVER_TYPES:
        raise HTTPException(415, f"cover must be jpeg/png/webp, got {ctype!r}")
    data = await file.read(_COVER_MAX_BYTES + 1)
    if len(data) > _COVER_MAX_BYTES:
        raise HTTPException(413, f"cover exceeds {_COVER_MAX_BYTES} bytes")

    ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}[ctype]
    new_key = f"course-covers/{course.id}/{uuid.uuid4()}.{ext}"
    upload_bytes(new_key, data, ctype)

    old_key = course.cover_image_key
    course.cover_image_key = new_key
    db.commit()

    if old_key:
        try:
            delete_object(old_key)
        except Exception:
            pass  # the new cover is live; old object is just orphaned
    return {"cover_url": f"/api/v1/courses/{slug}/cover"}


@router.delete("/courses/{slug}/cover")
def delete_course_cover(
    slug: str,
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    course = db.scalar(select(Course).where(Course.slug == slug))
    if not course:
        raise HTTPException(404, "course not found")
    if not course.cover_image_key:
        return {"ok": True}
    old_key = course.cover_image_key
    course.cover_image_key = None
    db.commit()
    try:
        delete_object(old_key)
    except Exception:
        pass
    return {"ok": True}


# ---------- Lesson management ----------
# Lessons are created via the upload/finalize flow; these endpoints only
# cover after-the-fact edits (rename, reorder, toggle preview, per-lesson
# pricing, deletion).

class LessonPatch(BaseModel):
    title: Optional[str] = None
    position: Optional[int] = None
    is_preview: Optional[bool] = None
    price_baht: Optional[int] = None


@router.patch("/lessons/{lesson_id}")
def update_lesson(
    lesson_id: str,
    body: LessonPatch,
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    lesson = db.get(Lesson, lesson_id)
    if not lesson:
        raise HTTPException(404, "lesson not found")
    patch = body.model_dump(exclude_unset=True)
    # Position swaps need to dodge the (course_id, position) unique
    # constraint — if the target slot is taken, swap with the occupant.
    new_pos = patch.get("position")
    if new_pos is not None and new_pos != lesson.position:
        other = db.scalar(
            select(Lesson).where(
                Lesson.course_id == lesson.course_id,
                Lesson.position == new_pos,
                Lesson.id != lesson.id,
            )
        )
        if other:
            other.position, lesson.position = lesson.position, new_pos
            patch.pop("position")
    for k, v in patch.items():
        setattr(lesson, k, v)
    db.commit()
    return {"ok": True}


@router.delete("/lessons/{lesson_id}")
def delete_lesson(
    lesson_id: str,
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    lesson = db.get(Lesson, lesson_id)
    if not lesson:
        raise HTTPException(404, "lesson not found")
    # Refuse if anyone holds a paid LessonEntitlement — like courses, force
    # admin to revoke first instead of silently destroying paid access.
    from ..models import LessonEntitlement
    ent_count = db.scalar(
        select(func.count()).select_from(LessonEntitlement)
        .where(LessonEntitlement.lesson_id == lesson.id)
    ) or 0
    if ent_count > 0:
        raise HTTPException(409, f"lesson has {ent_count} active entitlements — revoke first")
    db.delete(lesson); db.commit()
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
def get_settings(
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    from ..settings_db import get_payment_settings, get_email_settings
    p = get_payment_settings(db)
    e = get_email_settings(db)
    return {
        "email": {
            "provider": e.provider,
            "configured": e.configured,
            "from": e.from_email,
            "from_name": e.from_name or None,
            "api_key_set": bool(e.api_key),
            # SMTP-only fields kept for the legacy panel — only meaningful
            # when provider == "smtp".
            "smtp_host": e.smtp_host,
            "smtp_port": e.smtp_port,
            "smtp_use_tls": e.smtp_use_tls,
            "smtp_user": e.smtp_user or None,
            "smtp_password_set": bool(e.smtp_password),
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
            "method": "slip_upload",
            "currency": settings.STRIPE_CURRENCY,
            "slipok_configured": p.slipok_enabled,
            "receiver_bank_set": p.receiver_bank_set,
        },
        "security": {
            "kek_set": bool(settings.KEK_BASE64 or settings.KEK_FILE),
            "jwt_secret_set": bool(settings.JWT_SECRET),
            "jwt_ttl_min": settings.JWT_TTL_MIN,
            "pb_session_ttl_sec": settings.PB_SESSION_TTL_SEC,
            "key_rate_limit_per_min": settings.KEY_RATE_LIMIT_PER_MIN,
            "max_concurrent_sessions": settings.MAX_CONCURRENT_SESSIONS,
            "e2e_bypass_set": bool(settings.E2E_BYPASS_TOKEN),
        },
        "cors_origins": [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()],
    }


# ---------- Payment settings (admin-editable, DB-backed) ----------
# `get` masks the SlipOK API key — we never echo it back. Other fields are
# returned as-is so the admin can see/edit them. `put` accepts partial
# updates: omitting a field leaves it unchanged; sending null clears it
# (falls back to .env); empty string is treated as "user explicitly cleared
# to nothing" and stored as such.

class PaymentSettingsPatch(BaseModel):
    receiver_bank_name: Optional[str] = None
    receiver_bank_account: Optional[str] = None
    receiver_name: Optional[str] = None
    promptpay_id: Optional[str] = None
    # Special semantics: empty string means "leave unchanged" so the admin
    # can update other fields without re-typing the API key. Pass an
    # actual value to overwrite. Pass null (model_dump(exclude_unset)) is
    # equivalent to "leave unchanged" too.
    slipok_api_key: Optional[str] = None
    slipok_branch_id: Optional[str] = None
    # When true, the API key is force-cleared regardless of slipok_api_key.
    clear_slipok_api_key: bool = False


@router.get("/payment-settings")
def get_payment_settings_admin(
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    from ..settings_db import get_payment_settings
    from ..models import AppSettings
    row = db.get(AppSettings, 1)
    p = get_payment_settings(db)
    # Show effective values (DB → env fallback) + per-field "did the admin
    # override this in DB?" flags so the UI can show "(default from .env)".
    def _override(col: str | None) -> bool:
        return col is not None
    return {
        "receiver_bank_name": p.receiver_bank_name,
        "receiver_bank_account": p.receiver_bank_account,
        "receiver_name": p.receiver_name,
        "promptpay_id": p.promptpay_id,
        "slipok_branch_id": p.slipok_branch_id,
        "slipok_api_key_set": bool(p.slipok_api_key),
        "overrides": {
            "receiver_bank_name": _override(row and row.receiver_bank_name),
            "receiver_bank_account": _override(row and row.receiver_bank_account),
            "receiver_name": _override(row and row.receiver_name),
            "promptpay_id": _override(row and row.promptpay_id),
            "slipok_branch_id": _override(row and row.slipok_branch_id),
            "slipok_api_key": _override(row and row.slipok_api_key),
        },
        "slipok_enabled": p.slipok_enabled,
        "receiver_bank_set": p.receiver_bank_set,
    }


@router.put("/payment-settings")
def update_payment_settings_admin(
    body: PaymentSettingsPatch,
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    from ..settings_db import update_payment_settings
    raw = body.model_dump(exclude_unset=True)
    kwargs: dict = {}
    for f in ("receiver_bank_name", "receiver_bank_account",
              "receiver_name", "promptpay_id", "slipok_branch_id"):
        if f in raw:
            kwargs[f] = raw[f]
    # SlipOK key has its own semantics — see PaymentSettingsPatch docstring.
    if body.clear_slipok_api_key:
        kwargs["slipok_api_key"] = None
    elif "slipok_api_key" in raw and raw["slipok_api_key"] not in (None, ""):
        kwargs["slipok_api_key"] = raw["slipok_api_key"]
    update_payment_settings(db, **kwargs)
    return {"ok": True}


class TestEmailBody(BaseModel):
    to: EmailStr


# ---------- Email-provider settings (admin-editable, DB-backed) ----------
# Same overlay model as payment-settings: NULL column = fall back to .env,
# any other value overrides it. The api_key field uses the "" = leave
# unchanged convention so the admin can edit other fields without retyping
# the secret. clear_api_key=true wipes it back to env.

class EmailSettingsPatch(BaseModel):
    provider: Optional[Literal["smtp", "resend", "postmark", "sendgrid", "disabled"]] = None
    api_key: Optional[str] = None
    from_email: Optional[EmailStr] = None
    from_name: Optional[str] = None
    clear_api_key: bool = False


@router.get("/email-settings")
def get_email_settings_admin(
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    from ..settings_db import get_email_settings
    from ..models import AppSettings as _AS
    row = db.get(_AS, 1)
    e = get_email_settings(db)

    def _override(col: object) -> bool:
        return col is not None
    return {
        "provider": e.provider,
        "api_key_set": bool(e.api_key),
        "from_email": e.from_email,
        "from_name": e.from_name,
        "configured": e.configured,
        "smtp": {
            "host": e.smtp_host,
            "port": e.smtp_port,
            "use_tls": e.smtp_use_tls,
            "user": e.smtp_user or None,
            "password_set": bool(e.smtp_password),
        },
        "overrides": {
            "provider": _override(row and row.email_provider),
            "api_key": _override(row and row.email_api_key),
            "from_email": _override(row and row.email_from),
            "from_name": _override(row and row.email_from_name),
        },
    }


@router.put("/email-settings")
def update_email_settings_admin(
    body: EmailSettingsPatch,
    request: Request,
    actor: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    from ..settings_db import update_email_settings
    raw = body.model_dump(exclude_unset=True)
    kwargs: dict = {}
    if "provider" in raw:
        kwargs["provider"] = raw["provider"]
    if "from_email" in raw:
        kwargs["from_email"] = raw["from_email"]
    if "from_name" in raw:
        kwargs["from_name"] = raw["from_name"]
    if body.clear_api_key:
        kwargs["api_key"] = None
    elif "api_key" in raw and raw["api_key"] not in (None, ""):
        kwargs["api_key"] = raw["api_key"]

    update_email_settings(db, **kwargs)
    audit_record(
        db, actor=actor, action="email_settings.update",
        target_type="settings", target_id="email",
        summary=f"แก้ไขค่าระบบอีเมล (provider={kwargs.get('provider', 'unchanged')})",
        detail=json.dumps({k: ("***" if k == "api_key" and v else v)
                           for k, v in kwargs.items()}),
        ip=_client_ip(request),
    )
    db.commit()
    return {"ok": True}


@router.post("/settings/test-email")
async def admin_send_test_email(
    body: TestEmailBody,
    _: User = Depends(current_admin),
):
    """Send a one-shot test email through the currently configured provider.

    Reads `app_settings` at send-time, so flipping provider/api_key in the
    UI takes effect immediately — no restart. If the provider is `disabled`
    or the api_key is missing, this is a no-op (logs a warning)."""
    from ..email import send_email
    await send_email(
        body.to,
        "ทดสอบระบบส่งอีเมล",
        "นี่คือข้อความทดสอบจาก Course Platform — หากได้รับแสดงว่าระบบส่งอีเมลทำงานปกติ",
        "<p>นี่คือข้อความทดสอบจาก Course Platform</p>"
        "<p style='color:#888'>หากได้รับแสดงว่าระบบส่งอีเมลทำงานปกติ</p>",
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


# ---------- Slip-upload review ----------
# Admin sees pending slips, opens the image via a short-lived presigned URL,
# and either approves (which creates the Payment + Enrollment exactly like
# Stripe webhook does) or rejects (which leaves the slip on file but never
# unlocks playback). Both transitions are idempotent.

class SlipReviewBody(BaseModel):
    note: str | None = None


@router.get("/slip-uploads")
def list_slip_uploads(
    status_filter: str = "pending",
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    q = select(SlipUpload).order_by(SlipUpload.created_at.desc()).limit(200)
    if status_filter != "all":
        q = q.where(SlipUpload.status == status_filter)
    rows = db.scalars(q).all()
    out = []
    for s in rows:
        buyer = db.get(User, s.user_id)
        course = db.get(Course, s.course_id) if s.course_id else None
        lesson = db.get(Lesson, s.lesson_id) if s.lesson_id else None
        # 5-minute presign — long enough for the admin to open + scrutinize,
        # short enough that a forwarded link can't be reused later.
        image_url = presigned_get_url(s.r2_image_key, expires_in=300)
        out.append({
            "id": str(s.id),
            "user_email": buyer.email if buyer else None,
            "amount_baht": s.amount_baht,
            "status": s.status,
            "target": (
                {"type": "course", "title": course.title, "slug": course.slug}
                if course else {"type": "lesson", "title": lesson.title} if lesson
                else None
            ),
            "slip_ref": s.slip_ref,
            "verify_response": s.verify_response,
            "image_url": image_url,
            "created_at": s.created_at.isoformat(),
            "reviewed_at": s.reviewed_at.isoformat() if s.reviewed_at else None,
            "review_note": s.review_note,
        })
    return out


@router.post("/slip-uploads/{slip_id}/approve")
def approve_slip(
    slip_id: str,
    body: SlipReviewBody,
    actor: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    slip = db.get(SlipUpload, slip_id)
    if not slip:
        raise HTTPException(404, "slip not found")
    if slip.status in ("auto_approved", "admin_approved"):
        return {"ok": True, "already": slip.status}
    if slip.status == "rejected":
        raise HTTPException(409, "slip already rejected — buyer must re-upload")
    slip.status = "admin_approved"
    materialize_approval(
        db, slip, method="slip_manual", reviewed_by=actor.id,
        note=body.note or "admin approve",
    )
    db.commit()
    return {"ok": True, "payment_id": str(slip.payment_id) if slip.payment_id else None}


@router.post("/slip-uploads/{slip_id}/reject")
def reject_slip(
    slip_id: str,
    body: SlipReviewBody,
    actor: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    slip = db.get(SlipUpload, slip_id)
    if not slip:
        raise HTTPException(404, "slip not found")
    if slip.status in ("auto_approved", "admin_approved"):
        raise HTTPException(409, "already approved — issue a refund instead")
    slip.status = "rejected"
    slip.reviewed_by = actor.id
    slip.reviewed_at = dt.datetime.now(dt.timezone.utc)
    slip.review_note = body.note or "admin reject"
    db.commit()
    return {"ok": True}


# =====================================================================
# User management (Tier 3) — search, suspend/promote, devices, reset,
# delete, bulk ops, CSV export. Every state-changer writes to the audit
# log so the /admin/audit page can render a forensic timeline.
# =====================================================================


def _client_ip(req: Request | None) -> str | None:
    if req is None:
        return None
    fwd = req.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return req.client.host if req.client else None


def _user_brief(u: User) -> dict:
    return {
        "id": str(u.id),
        "email": u.email,
        "is_admin": u.is_admin,
        "is_active": u.is_active,
        "email_verified": u.email_verified,
        "created_at": u.created_at.isoformat(),
    }


@router.get("/users/search")
def search_users(
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
    q: str | None = None,
    role: str | None = None,            # admin | user
    status_filter: str | None = None,   # active | suspended | unverified
    sort: str = "created_desc",         # created_desc | created_asc | email_asc
    limit: int = 100,
    offset: int = 0,
):
    """Filtered user list — replaces /users for the new admin page. Existing
    /users endpoint is kept for back-compat with the simple table."""
    stmt = select(User)
    if q:
        stmt = stmt.where(User.email.ilike(f"%{q.strip()}%"))
    if role == "admin":
        stmt = stmt.where(User.is_admin.is_(True))
    elif role == "user":
        stmt = stmt.where(User.is_admin.is_(False))
    if status_filter == "active":
        stmt = stmt.where(User.is_active.is_(True))
    elif status_filter == "suspended":
        stmt = stmt.where(User.is_active.is_(False))
    elif status_filter == "unverified":
        stmt = stmt.where(User.email_verified.is_(False))

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0

    if sort == "created_asc":
        stmt = stmt.order_by(User.created_at.asc())
    elif sort == "email_asc":
        stmt = stmt.order_by(User.email.asc())
    else:
        stmt = stmt.order_by(User.created_at.desc())
    rows = db.scalars(stmt.limit(min(limit, 500)).offset(offset)).all()
    return {
        "total": total,
        "rows": [_user_brief(u) for u in rows],
    }


@router.get("/users/{user_id}")
def user_detail(
    user_id: str,
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "user not found")

    enrollments = db.execute(
        select(Enrollment, Course)
        .join(Course, Course.id == Enrollment.course_id)
        .where(Enrollment.user_id == u.id)
        .order_by(Enrollment.created_at.desc())
    ).all()

    payments = db.scalars(
        select(Payment).where(Payment.user_id == u.id)
        .order_by(Payment.created_at.desc()).limit(50)
    ).all()

    devices = db.scalars(
        select(TrustedDevice).where(TrustedDevice.user_id == u.id)
        .order_by(TrustedDevice.last_seen_at.desc())
    ).all()

    logins = db.scalars(
        select(LoginEvent).where(LoginEvent.user_id == u.id)
        .order_by(LoginEvent.created_at.desc()).limit(20)
    ).all()

    slips = db.scalars(
        select(SlipUpload).where(SlipUpload.user_id == u.id)
        .order_by(SlipUpload.created_at.desc()).limit(20)
    ).all()

    return {
        "user": {
            **_user_brief(u),
            "tax_name": u.tax_name, "tax_id": u.tax_id,
        },
        "enrollments": [
            {
                "id": str(e.id), "course_slug": c.slug, "course_title": c.title,
                "expires_at": e.expires_at.isoformat() if e.expires_at else None,
                "created_at": e.created_at.isoformat(),
            } for e, c in enrollments
        ],
        "payments": [
            {
                "id": str(p.id), "amount_baht": p.amount_baht, "status": p.status,
                "invoice_number": p.invoice_number,
                "created_at": p.created_at.isoformat(),
            } for p in payments
        ],
        "devices": [
            {
                "id": str(d.id), "label": d.label,
                "last_seen_at": d.last_seen_at.isoformat() if d.last_seen_at else None,
                "last_ip": str(d.last_ip) if d.last_ip else None,
            } for d in devices
        ],
        "logins": [
            {
                "id": str(l.id), "status": l.status, "suspicious": l.suspicious,
                "ip": str(l.ip) if l.ip else None,
                "created_at": l.created_at.isoformat(),
            } for l in logins
        ],
        "slips": [
            {
                "id": str(s.id), "status": s.status, "amount_baht": s.amount_baht,
                "created_at": s.created_at.isoformat(),
            } for s in slips
        ],
    }


class UserPatch(BaseModel):
    is_active: Optional[bool] = None
    is_admin: Optional[bool] = None


@router.patch("/users/{user_id}")
def patch_user(
    user_id: str,
    body: UserPatch,
    request: Request,
    actor: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "user not found")
    if u.id == actor.id:
        raise HTTPException(400, "ห้ามแก้บัญชีตัวเอง — ใช้แอดมินคนอื่น")

    changes: dict = {}
    summary_parts: list[str] = []
    if body.is_active is not None and body.is_active != u.is_active:
        changes["is_active"] = {"from": u.is_active, "to": body.is_active}
        u.is_active = body.is_active
        summary_parts.append("ปลดระงับ" if body.is_active else "ระงับ")
    if body.is_admin is not None and body.is_admin != u.is_admin:
        changes["is_admin"] = {"from": u.is_admin, "to": body.is_admin}
        u.is_admin = body.is_admin
        summary_parts.append("แต่งตั้งแอดมิน" if body.is_admin else "ถอดแอดมิน")
    if not changes:
        return {"ok": True, "noop": True}

    # Suspending or demoting → also revoke devices so the user is logged out.
    if (body.is_active is False) or (body.is_admin is False):
        db.execute(sa_delete(TrustedDevice).where(TrustedDevice.user_id == u.id))

    audit_record(
        db, actor=actor, action="user.patch",
        target_type="user", target_id=str(u.id),
        summary=f"{' + '.join(summary_parts)} {u.email}",
        detail=json.dumps(changes),
        ip=_client_ip(request),
    )
    db.commit()
    return {"ok": True, "user": _user_brief(u)}


@router.post("/users/{user_id}/revoke-devices")
def revoke_user_devices(
    user_id: str,
    request: Request,
    actor: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "user not found")
    n = db.scalar(
        select(func.count()).select_from(TrustedDevice)
        .where(TrustedDevice.user_id == u.id)
    ) or 0
    db.execute(sa_delete(TrustedDevice).where(TrustedDevice.user_id == u.id))
    audit_record(
        db, actor=actor, action="user.revoke_devices",
        target_type="user", target_id=str(u.id),
        summary=f"บังคับ logout {u.email} ({n} อุปกรณ์)",
        ip=_client_ip(request),
    )
    db.commit()
    return {"ok": True, "revoked": n}


@router.post("/users/{user_id}/reset-password", status_code=202)
def admin_reset_password(
    user_id: str,
    request: Request,
    actor: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    """Admin-initiated password reset. Issues an email_token (purpose=reset)
    just like the user-self-service flow; surfaces the URL in the response
    so the admin can copy/forward it if email delivery is iffy."""
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "user not found")
    raw = secrets.token_urlsafe(32)
    db.add(EmailToken(
        user_id=u.id, purpose="reset",
        token_hash=hashlib.sha256(raw.encode()).hexdigest(),
        expires_at=dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=30),
    ))
    reset_url = f"{settings.FRONTEND_URL}/reset-password?token={raw}"
    audit_record(
        db, actor=actor, action="user.reset_password",
        target_type="user", target_id=str(u.id),
        summary=f"ออกลิงก์รีเซตรหัสให้ {u.email}",
        ip=_client_ip(request),
    )
    db.commit()
    return {"ok": True, "reset_url": reset_url, "ttl_minutes": 30}


@router.delete("/users/{user_id}")
def delete_user(
    user_id: str,
    request: Request,
    actor: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    u = db.get(User, user_id)
    if not u:
        raise HTTPException(404, "user not found")
    if u.id == actor.id:
        raise HTTPException(400, "ห้ามลบตัวเอง")
    email = u.email
    db.delete(u)
    audit_record(
        db, actor=actor, action="user.delete",
        target_type="user", target_id=str(user_id),
        summary=f"ลบบัญชี {email}",
        ip=_client_ip(request),
    )
    db.commit()
    return {"ok": True}


class BulkUserBody(BaseModel):
    user_ids: list[str]
    action: Literal["suspend", "activate", "promote", "demote", "delete"]


@router.post("/users/bulk")
def bulk_user_action(
    body: BulkUserBody,
    request: Request,
    actor: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    if not body.user_ids:
        raise HTTPException(400, "ไม่มี user_ids")
    if str(actor.id) in body.user_ids:
        raise HTTPException(400, "ห้ามมีตัวเองใน bulk action")

    rows = db.scalars(select(User).where(User.id.in_(body.user_ids))).all()
    affected = 0
    for u in rows:
        if body.action == "suspend":
            if u.is_active:
                u.is_active = False
                db.execute(sa_delete(TrustedDevice).where(TrustedDevice.user_id == u.id))
                affected += 1
        elif body.action == "activate":
            if not u.is_active:
                u.is_active = True
                affected += 1
        elif body.action == "promote":
            if not u.is_admin:
                u.is_admin = True
                affected += 1
        elif body.action == "demote":
            if u.is_admin:
                u.is_admin = False
                db.execute(sa_delete(TrustedDevice).where(TrustedDevice.user_id == u.id))
                affected += 1
        elif body.action == "delete":
            db.delete(u)
            affected += 1

    audit_record(
        db, actor=actor, action=f"users.bulk.{body.action}",
        target_type="user", target_id=None,
        summary=f"bulk {body.action} {affected} บัญชี",
        detail=json.dumps({"user_ids": body.user_ids, "affected": affected}),
        ip=_client_ip(request),
    )
    db.commit()
    return {"ok": True, "affected": affected}


@router.get("/users.csv")
def export_users_csv(
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    rows = db.scalars(select(User).order_by(User.created_at.asc())).all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "email", "is_admin", "is_active", "email_verified", "created_at"])
    for u in rows:
        w.writerow([
            str(u.id), u.email, int(u.is_admin), int(u.is_active),
            int(u.email_verified), u.created_at.isoformat(),
        ])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=users.csv"},
    )


@router.get("/payments.csv")
def export_payments_csv(
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    rows = db.execute(
        select(Payment, User).join(User, User.id == Payment.user_id)
        .order_by(Payment.created_at.asc())
    ).all()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([
        "id", "user_email", "amount_baht", "subtotal_baht", "vat_baht",
        "status", "invoice_number", "method", "created_at",
    ])
    for p, u in rows:
        w.writerow([
            str(p.id), u.email, p.amount_baht, p.subtotal_baht, p.vat_baht,
            p.status, p.invoice_number or "", p.payment_method,
            p.created_at.isoformat(),
        ])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=payments.csv"},
    )


# =====================================================================
# Dashboard summary — revenue today/month/total, pending slips, recent
# signups, top courses, sparkline, key denial trend.
# =====================================================================


@router.get("/dashboard")
def dashboard_summary(
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    now = dt.datetime.now(dt.timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month_start = today_start.replace(day=1)
    week_ago = now - dt.timedelta(days=7)
    sparkline_start = today_start - dt.timedelta(days=29)

    paid_filter = Payment.status == "paid"

    revenue_today = db.scalar(
        select(func.coalesce(func.sum(Payment.amount_baht), 0)).where(
            paid_filter, Payment.created_at >= today_start,
        )
    ) or 0
    revenue_month = db.scalar(
        select(func.coalesce(func.sum(Payment.amount_baht), 0)).where(
            paid_filter, Payment.created_at >= month_start,
        )
    ) or 0
    revenue_total = db.scalar(
        select(func.coalesce(func.sum(Payment.amount_baht), 0)).where(paid_filter)
    ) or 0

    pending_slips = db.scalar(
        select(func.count()).select_from(SlipUpload).where(SlipUpload.status == "pending")
    ) or 0

    new_users_7d = db.scalar(
        select(func.count()).select_from(User).where(User.created_at >= week_ago)
    ) or 0

    coupons_today = db.scalar(
        select(func.count()).select_from(CouponRedemption)
        .where(CouponRedemption.redeemed_at >= today_start)
    ) or 0

    suspicious_24h = db.scalar(
        select(func.count()).select_from(LoginEvent).where(
            LoginEvent.suspicious.is_(True),
            LoginEvent.created_at >= now - dt.timedelta(hours=24),
        )
    ) or 0

    # Revenue sparkline — last 30 days, one bucket per day. Buckets with no
    # payments fall through as 0 — the frontend renders a flat tick there.
    daily_rev_rows = db.execute(
        select(
            func.date_trunc("day", Payment.created_at).label("d"),
            func.coalesce(func.sum(Payment.amount_baht), 0).label("v"),
        ).where(paid_filter, Payment.created_at >= sparkline_start)
        .group_by("d").order_by("d")
    ).all()
    rev_by_day: dict[str, int] = {
        r.d.date().isoformat(): int(r.v) for r in daily_rev_rows if r.d is not None
    }
    sparkline: list[dict] = []
    for i in range(30):
        d = (sparkline_start + dt.timedelta(days=i)).date().isoformat()
        sparkline.append({"date": d, "revenue_baht": rev_by_day.get(d, 0)})

    # Top-selling courses by paid Payment count (last 30 days).
    top_rows = db.execute(
        select(
            Course.slug, Course.title, func.count(Payment.id).label("cnt"),
            func.coalesce(func.sum(Payment.amount_baht), 0).label("rev"),
        )
        .join(Payment, Payment.course_id == Course.id)
        .where(paid_filter, Payment.created_at >= sparkline_start)
        .group_by(Course.id).order_by(func.count(Payment.id).desc()).limit(5)
    ).all()
    top_courses = [
        {"slug": r.slug, "title": r.title, "sold": int(r.cnt), "revenue_baht": int(r.rev)}
        for r in top_rows
    ]

    return {
        "revenue": {
            "today_baht": int(revenue_today),
            "month_baht": int(revenue_month),
            "total_baht": int(revenue_total),
        },
        "pending_slips": int(pending_slips),
        "new_users_7d": int(new_users_7d),
        "coupons_today": int(coupons_today),
        "suspicious_logins_24h": int(suspicious_24h),
        "top_courses": top_courses,
        "sparkline_30d": sparkline,
    }


# =====================================================================
# Audit log + email broadcast
# =====================================================================


@router.get("/audit")
def list_audit(
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
    limit: int = 200,
    offset: int = 0,
    actor_email: str | None = None,
    action: str | None = None,
):
    stmt = select(AdminAuditLog)
    if actor_email:
        stmt = stmt.where(AdminAuditLog.actor_email == actor_email)
    if action:
        stmt = stmt.where(AdminAuditLog.action == action)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.order_by(AdminAuditLog.created_at.desc())
        .limit(min(limit, 500)).offset(offset)
    ).all()
    return {
        "total": total,
        "rows": [
            {
                "id": str(r.id),
                "actor_email": r.actor_email,
                "action": r.action,
                "target_type": r.target_type,
                "target_id": r.target_id,
                "summary": r.summary,
                "detail": r.detail,
                "ip": str(r.ip) if r.ip else None,
                "created_at": r.created_at.isoformat(),
            } for r in rows
        ],
    }


class BroadcastBody(BaseModel):
    audience: Literal["all", "active", "admins", "enrolled"]
    subject: str
    body: str
    course_slug: Optional[str] = None  # required when audience="enrolled"
    dry_run: bool = True               # default safe — preview the count first


@router.post("/email-broadcast")
def email_broadcast(
    body: BroadcastBody,
    request: Request,
    actor: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    """Resolve the audience to a list of email addresses + record the
    broadcast in the audit log. Actual SMTP delivery is queued elsewhere
    (out of scope here) — `dry_run` returns the recipient count so admin
    can confirm scope before unleashing."""
    if body.audience == "enrolled":
        if not body.course_slug:
            raise HTTPException(400, "audience=enrolled ต้องระบุ course_slug")
        course = db.scalar(select(Course).where(Course.slug == body.course_slug))
        if not course:
            raise HTTPException(404, "course not found")
        recips = db.scalars(
            select(User.email).join(Enrollment, Enrollment.user_id == User.id)
            .where(Enrollment.course_id == course.id, User.is_active.is_(True))
        ).all()
    elif body.audience == "all":
        recips = db.scalars(select(User.email)).all()
    elif body.audience == "active":
        recips = db.scalars(select(User.email).where(User.is_active.is_(True))).all()
    elif body.audience == "admins":
        recips = db.scalars(select(User.email).where(User.is_admin.is_(True))).all()
    else:
        raise HTTPException(400, "unknown audience")

    if body.dry_run:
        return {"recipient_count": len(recips), "dry_run": True}

    audit_record(
        db, actor=actor, action="email.broadcast",
        target_type="audience", target_id=body.audience,
        summary=f"ส่งเมล {len(recips)} คน · {body.subject}",
        detail=json.dumps({
            "audience": body.audience, "course_slug": body.course_slug,
            "subject": body.subject, "preview": body.body[:200],
            "recipient_count": len(recips),
        }),
        ip=_client_ip(request),
    )
    db.commit()
    # Hand off to the existing email queue is left to a future hook —
    # for now the dispatch happens via background task elsewhere.
    return {"recipient_count": len(recips), "dry_run": False, "queued": True}


# ---------- Video health dashboard ----------
# One aggregate endpoint that surfaces every signal we already collect about
# the video pipeline — encode jobs, key access log, R2 reachability, live
# Redis playback sessions — so an admin doesn't have to grep three places to
# answer "is video working right now?". Read-only, no audit log.

# Suspicious-pattern thresholds. Tuned for "noticeable but not panicky":
#   - one IP serving >= 2 distinct logged-in users in 24h is unusual but not
#     fatal (family on shared NAT). Flag, don't block.
#   - one user hitting >= 4 distinct IPs in 24h is the typical sharing
#     signature once you exclude mobile-LTE roaming.
_SUSPICIOUS_USERS_PER_IP = 2
_SUSPICIOUS_IPS_PER_USER = 4


def _hour_buckets(rows: list[tuple[dt.datetime, str | bool]], now: dt.datetime,
                  field_keys: list[str]) -> list[dict]:
    """Bin a list of (created_at, key) tuples into 24 hourly buckets ending
    at `now`. Returns 24 dicts, oldest first, each with `hour` (ISO ts of
    bucket start) plus a count for every key in `field_keys`."""
    buckets: list[dict[str, object]] = []
    for h in range(23, -1, -1):
        start = (now - dt.timedelta(hours=h + 1)).replace(minute=0, second=0, microsecond=0)
        bucket: dict[str, object] = {"hour": start.isoformat()}
        for k in field_keys:
            bucket[k] = 0
        buckets.append(bucket)
    base = (now - dt.timedelta(hours=24)).replace(minute=0, second=0, microsecond=0)
    for created_at, key in rows:
        if created_at < base:
            continue
        idx = int((created_at - base).total_seconds() // 3600)
        if 0 <= idx < 24:
            mapped = str(key)
            if mapped in buckets[idx]:
                buckets[idx][mapped] = int(buckets[idx][mapped]) + 1  # type: ignore[arg-type]
    return buckets


async def _r2_health() -> dict:
    """Cheap reachability check: HEAD the bucket. Times the round-trip in ms.
    Boto3 is sync, so we offload to a thread to avoid blocking the event loop."""
    import asyncio
    from ..r2 import get_r2_client

    def _probe() -> tuple[bool, float, str | None]:
        if not settings.R2_BUCKET or not settings.R2_ACCESS_KEY_ID:
            return (False, 0.0, "R2 credentials not configured")
        t0 = time.monotonic()
        try:
            client = get_r2_client()
            client.head_bucket(Bucket=settings.R2_BUCKET)
            return (True, (time.monotonic() - t0) * 1000.0, None)
        except Exception as e:  # boto exceptions vary; collapse to string
            return (False, (time.monotonic() - t0) * 1000.0, f"{type(e).__name__}: {e}")

    reachable, ms, err = await asyncio.get_event_loop().run_in_executor(None, _probe)
    return {
        "reachable": reachable,
        "latency_ms": round(ms, 1),
        "error": err,
        "bucket": settings.R2_BUCKET or None,
    }


async def _live_sessions(redis: Redis) -> dict:
    """Walk Redis for `pbsess:user:*` set keys. Each set holds active session
    tokens for one user; cardinality = active concurrent playbacks. SCAN
    instead of KEYS so this stays cheap on a large fleet."""
    total = 0
    near_max: list[dict] = []
    max_allowed = settings.MAX_CONCURRENT_SESSIONS
    threshold = max(1, max_allowed - 1)  # warn one below the wall
    async for key in redis.scan_iter(match="pbsess:user:*", count=200):
        # `key` may be bytes depending on connection decode_responses; normalise.
        key_s = key.decode() if isinstance(key, bytes) else key
        n = await redis.scard(key_s)
        total += int(n)
        if n >= threshold:
            user_id = key_s.rsplit(":", 1)[-1]
            near_max.append({"user_id": user_id, "count": int(n)})
    near_max.sort(key=lambda r: -r["count"])
    return {
        "total_active": total,
        "max_per_user": max_allowed,
        "near_max": near_max[:20],
    }


@router.get("/video-health")
async def video_health(
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
    redis: Redis = Depends(get_redis),
):
    now = dt.datetime.now(dt.timezone.utc)
    day_ago = now - dt.timedelta(hours=24)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    # ---- Encode pipeline ----
    enc_rows = db.execute(
        select(EncodeJob.status, func.count())
        .where(EncodeJob.updated_at >= day_ago)
        .group_by(EncodeJob.status)
    ).all()
    enc_counts = {"pending": 0, "running": 0, "done": 0, "failed": 0}
    for status_, n in enc_rows:
        if status_ in enc_counts:
            enc_counts[status_] = int(n)

    failed_jobs = db.scalars(
        select(EncodeJob).where(EncodeJob.status == "failed")
        .order_by(EncodeJob.updated_at.desc()).limit(10)
    ).all()
    recent_failed = [
        {
            "id": str(j.id), "course_slug": j.course_slug,
            "lesson_title": j.lesson_title,
            "error": (j.error or "")[:300],
            "created_at": j.created_at.isoformat(),
            "updated_at": j.updated_at.isoformat(),
        }
        for j in failed_jobs
    ]

    done_jobs = db.scalars(
        select(EncodeJob).where(EncodeJob.status == "done")
        .order_by(EncodeJob.updated_at.desc()).limit(10)
    ).all()
    recent_done = [
        {
            "id": str(j.id), "course_slug": j.course_slug,
            "lesson_title": j.lesson_title,
            "created_at": j.created_at.isoformat(),
            "updated_at": j.updated_at.isoformat(),
            "duration_sec": int((j.updated_at - j.created_at).total_seconds()),
        }
        for j in done_jobs
    ]

    enc_24h_rows = db.execute(
        select(EncodeJob.created_at, EncodeJob.status)
        .where(EncodeJob.created_at >= day_ago)
    ).all()
    enc_sparkline = _hour_buckets(
        [(r[0], r[1]) for r in enc_24h_rows],
        now, ["pending", "running", "done", "failed"],
    )

    # ---- Playback (KeyAccessLog) ----
    grants_24h = db.scalar(
        select(func.count()).select_from(KeyAccessLog)
        .where(KeyAccessLog.created_at >= day_ago, KeyAccessLog.granted.is_(True))
    ) or 0
    denies_24h = db.scalar(
        select(func.count()).select_from(KeyAccessLog)
        .where(KeyAccessLog.created_at >= day_ago, KeyAccessLog.granted.is_(False))
    ) or 0

    deny_reason_rows = db.execute(
        select(KeyAccessLog.reason, func.count())
        .where(KeyAccessLog.created_at >= day_ago, KeyAccessLog.granted.is_(False))
        .group_by(KeyAccessLog.reason)
        .order_by(func.count().desc())
        .limit(10)
    ).all()
    deny_reasons = [
        {"reason": r[0] or "(unspecified)", "count": int(r[1])}
        for r in deny_reason_rows
    ]

    pb_24h_rows = db.execute(
        select(KeyAccessLog.created_at, KeyAccessLog.granted)
        .where(KeyAccessLog.created_at >= day_ago)
    ).all()
    pb_sparkline = _hour_buckets(
        [(r[0], "granted" if r[1] else "denied") for r in pb_24h_rows],
        now, ["granted", "denied"],
    )

    # ---- Suspicious patterns ----
    # One IP -> many distinct users
    multi_user_ip_rows = db.execute(
        select(
            KeyAccessLog.ip,
            func.count(func.distinct(KeyAccessLog.user_id)).label("user_count"),
            func.count().label("hits"),
        )
        .where(KeyAccessLog.created_at >= day_ago, KeyAccessLog.user_id.is_not(None))
        .group_by(KeyAccessLog.ip)
        .having(func.count(func.distinct(KeyAccessLog.user_id)) >= _SUSPICIOUS_USERS_PER_IP)
        .order_by(func.count(func.distinct(KeyAccessLog.user_id)).desc())
        .limit(20)
    ).all()
    multi_user_ips = [
        {"ip": str(r[0]) if r[0] else None,
         "user_count": int(r[1]), "request_count": int(r[2])}
        for r in multi_user_ip_rows
    ]

    # One user -> many distinct IPs
    multi_ip_user_rows = db.execute(
        select(
            KeyAccessLog.user_id,
            User.email,
            func.count(func.distinct(KeyAccessLog.ip)).label("ip_count"),
            func.count().label("hits"),
        )
        .join(User, User.id == KeyAccessLog.user_id)
        .where(KeyAccessLog.created_at >= day_ago)
        .group_by(KeyAccessLog.user_id, User.email)
        .having(func.count(func.distinct(KeyAccessLog.ip)) >= _SUSPICIOUS_IPS_PER_USER)
        .order_by(func.count(func.distinct(KeyAccessLog.ip)).desc())
        .limit(20)
    ).all()
    multi_ip_users = [
        {"user_id": str(r[0]), "email": r[1],
         "ip_count": int(r[2]), "request_count": int(r[3])}
        for r in multi_ip_user_rows
    ]

    # ---- Storage ----
    storage = await _r2_health()

    # ---- Live playback sessions (Redis) ----
    sessions = await _live_sessions(redis)

    # ---- Catalog totals ----
    videos_total = db.scalar(select(func.count()).select_from(Video)) or 0
    videos_today = db.scalar(
        select(func.count()).select_from(Video)
        .where(Video.created_at >= today_start)
    ) or 0

    return {
        "generated_at": now.isoformat(),
        "encode": {
            "last_24h": enc_counts,
            "recent_failed": recent_failed,
            "recent_done": recent_done,
            "sparkline_24h": enc_sparkline,
        },
        "playback": {
            "grants_24h": int(grants_24h),
            "denies_24h": int(denies_24h),
            "deny_reasons": deny_reasons,
            "sparkline_24h": pb_sparkline,
        },
        "suspicious": {
            "multi_user_ips": multi_user_ips,
            "multi_ip_users": multi_ip_users,
            "thresholds": {
                "users_per_ip": _SUSPICIOUS_USERS_PER_IP,
                "ips_per_user": _SUSPICIOUS_IPS_PER_USER,
            },
        },
        "storage": storage,
        "sessions": sessions,
        "videos": {
            "total": int(videos_total),
            "encoded_today": int(videos_today),
        },
    }
