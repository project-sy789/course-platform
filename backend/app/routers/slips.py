"""User-facing slip upload + own-status listing.

The slip itself is the legal record of the transfer; we keep the image in
R2 for the same retention as any payment record. Admin review + approval
live in routers/admin.py; this module only handles the buyer side."""
from __future__ import annotations

import datetime as dt
import json
import secrets
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_session
from ..deps import current_user, compute_enrollment_expiry
from ..invoice import split_vat_inclusive, allocate_invoice_number
from ..logging import log
from ..models import (
    Course, Enrollment, Lesson, LessonEntitlement, Payment, SlipUpload, User,
)
from ..r2 import upload_bytes
from ..slipok import configured as slipok_configured, verify_slip

router = APIRouter(prefix="/api/v1", tags=["slip-payments"])

# Slip images are PNG/JPEG/WebP from a bank app screenshot. 4 MB caps any
# legitimate slip; anything bigger is almost certainly an attempted abuse.
MAX_SLIP_BYTES = 4 * 1024 * 1024
ALLOWED_TYPES = {"image/png", "image/jpeg", "image/webp"}


def _resolve_target(
    db: Session, course_slug: str | None, lesson_id: str | None,
) -> tuple[Course | None, Lesson | None, int]:
    """Return (course, lesson, expected_amount_satang). Exactly one of
    course/lesson is non-null on return."""
    if course_slug and lesson_id:
        raise HTTPException(400, "specify course_slug OR lesson_id, not both")
    if not course_slug and not lesson_id:
        raise HTTPException(400, "specify course_slug or lesson_id")

    if course_slug:
        course = db.scalar(select(Course).where(Course.slug == course_slug))
        if not course:
            raise HTTPException(404, "course not found")
        if course.price_cents <= 0:
            raise HTTPException(400, "course is free")
        return course, None, course.price_cents

    lesson = db.get(Lesson, lesson_id)
    if not lesson or (lesson.price_cents or 0) <= 0:
        raise HTTPException(404, "lesson not purchasable")
    return None, lesson, lesson.price_cents


def materialize_approval(
    db: Session, slip: SlipUpload, *, method: str, reviewed_by: uuid.UUID | None,
    note: str,
) -> Payment:
    """Create the Payment + Enrollment / LessonEntitlement for an approved slip.

    Caller is responsible for setting slip.status and committing. Idempotent
    by `slip.payment_id`: a second call short-circuits to the existing row."""
    if slip.payment_id:
        return db.get(Payment, slip.payment_id)

    subtotal, vat = split_vat_inclusive(slip.amount_cents)
    user = db.get(User, slip.user_id)
    payment = Payment(
        user_id=slip.user_id,
        course_id=slip.course_id or (
            db.get(Lesson, slip.lesson_id).course_id if slip.lesson_id else None
        ),
        stripe_session_id=None,
        amount_cents=slip.amount_cents,
        subtotal_cents=subtotal,
        vat_cents=vat,
        buyer_tax_name=user.tax_name if user else None,
        buyer_tax_id=user.tax_id if user else None,
        buyer_tax_address=user.tax_address if user else None,
        buyer_tax_branch=user.tax_branch if user else None,
        currency="thb",
        status="paid",
        payment_method=method,
        slip_upload_id=slip.id,
        invoice_number=allocate_invoice_number(db),
    )
    db.add(payment)
    db.flush()
    slip.payment_id = payment.id

    if slip.course_id:
        existing = db.scalar(select(Enrollment).where(
            Enrollment.user_id == slip.user_id,
            Enrollment.course_id == slip.course_id,
        ))
        if not existing:
            course = db.get(Course, slip.course_id)
            db.add(Enrollment(
                user_id=slip.user_id, course_id=slip.course_id,
                expires_at=compute_enrollment_expiry(course) if course else None,
            ))
    elif slip.lesson_id:
        existing = db.scalar(select(LessonEntitlement).where(
            LessonEntitlement.user_id == slip.user_id,
            LessonEntitlement.lesson_id == slip.lesson_id,
        ))
        if not existing:
            db.add(LessonEntitlement(
                user_id=slip.user_id, lesson_id=slip.lesson_id,
            ))

    slip.reviewed_by = reviewed_by
    slip.reviewed_at = dt.datetime.now(dt.timezone.utc)
    slip.review_note = note
    log.info("slip_materialized",
             slip_id=str(slip.id), method=method,
             target_user_id=str(slip.user_id), payment_id=str(payment.id))
    return payment


@router.get("/slip-payments/info")
def slip_info():
    """Receiver bank info shown on the buyer page. No auth required —
    bank details aren't secret and the buyer needs them before login pays."""
    return {
        "bank_name": settings.RECEIVER_BANK_NAME,
        "account_number": settings.RECEIVER_BANK_ACCOUNT,
        "account_name": settings.RECEIVER_NAME,
        "promptpay_id": settings.PROMPTPAY_ID,
        "auto_verify": slipok_configured(),
    }


@router.post("/slip-payments/upload")
async def upload_slip(
    image: UploadFile = File(...),
    course_slug: str | None = Form(default=None),
    lesson_id: str | None = Form(default=None),
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
):
    """Buyer uploads a transfer slip. On success the response tells the buyer
    whether they need to wait for manual review or playback was already
    unlocked (auto-verified by SlipOK)."""
    course, lesson, expected = _resolve_target(db, course_slug, lesson_id)

    # Already enrolled / entitled? Refuse so we don't pile up duplicate slips.
    if course:
        if db.scalar(select(Enrollment).where(
            Enrollment.user_id == user.id, Enrollment.course_id == course.id,
        )):
            raise HTTPException(409, "already enrolled")
    if lesson:
        if db.scalar(select(LessonEntitlement).where(
            LessonEntitlement.user_id == user.id,
            LessonEntitlement.lesson_id == lesson.id,
        )):
            raise HTTPException(409, "already purchased")

    if image.content_type not in ALLOWED_TYPES:
        raise HTTPException(415, f"unsupported image type {image.content_type}")
    data = await image.read()
    if len(data) > MAX_SLIP_BYTES:
        raise HTTPException(413, "slip too large")
    if len(data) < 256:
        raise HTTPException(400, "slip image too small to be real")

    # Store the image first — we want it in R2 even if SlipOK is unreachable
    # so the admin can still review later.
    suffix = (image.filename or "").rsplit(".", 1)[-1].lower() or "jpg"
    if suffix not in ("jpg", "jpeg", "png", "webp"):
        suffix = "jpg"
    r2_key = f"slips/{user.id}/{dt.datetime.utcnow():%Y/%m}/{secrets.token_hex(8)}.{suffix}"
    upload_bytes(r2_key, data, image.content_type)

    slip = SlipUpload(
        user_id=user.id,
        course_id=course.id if course else None,
        lesson_id=lesson.id if lesson else None,
        amount_cents=expected,
        r2_image_key=r2_key,
        status="pending",
    )
    db.add(slip)
    db.flush()

    result = await verify_slip(data, image.filename or "slip.jpg", expected)
    slip.verify_response = json.dumps(result.raw)[:8000] if result.raw else None
    if result.slip_ref:
        # Catch dupes — DB unique on slip_ref does the heavy lifting; we just
        # surface a clean error.
        existing = db.scalar(
            select(SlipUpload).where(SlipUpload.slip_ref == result.slip_ref)
        )
        if existing and existing.id != slip.id:
            db.rollback()
            raise HTTPException(409, "slip already used")
        slip.slip_ref = result.slip_ref

    if result.auto_approve:
        slip.status = "auto_approved"
        materialize_approval(
            db, slip, method="slip_auto", reviewed_by=None,
            note=f"SlipOK auto-approve: {result.reason}",
        )
        db.commit()
        return {
            "status": "auto_approved",
            "message": "ตรวจสอบสลิปสำเร็จ ระบบเปิดสิทธิ์เรียนให้แล้ว",
            "slip_id": str(slip.id),
        }

    db.commit()
    log.info("slip_pending_review",
             slip_id=str(slip.id), target_user_id=str(user.id),
             reason=result.reason)
    return {
        "status": "pending",
        "message": (
            "ระบบยังตรวจสอบสลิปอัตโนมัติไม่ผ่าน "
            "ทีมงานจะตรวจสอบและเปิดสิทธิ์ให้ภายใน 24 ชั่วโมง"
        ) if slipok_configured() else (
            "ระบบได้รับสลิปแล้ว ทีมงานจะตรวจสอบและเปิดสิทธิ์ให้ภายใน 24 ชั่วโมง"
        ),
        "slip_id": str(slip.id),
    }


@router.get("/slip-payments")
def list_my_slips(
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
):
    rows = db.scalars(
        select(SlipUpload).where(SlipUpload.user_id == user.id)
        .order_by(SlipUpload.created_at.desc())
    ).all()
    return [
        {
            "id": str(s.id),
            "amount_cents": s.amount_cents,
            "status": s.status,
            "course_id": str(s.course_id) if s.course_id else None,
            "lesson_id": str(s.lesson_id) if s.lesson_id else None,
            "created_at": s.created_at.isoformat(),
            "reviewed_at": s.reviewed_at.isoformat() if s.reviewed_at else None,
        } for s in rows
    ]
