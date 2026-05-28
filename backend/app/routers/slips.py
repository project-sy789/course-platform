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

from ..db import get_session
from ..deps import current_user, compute_enrollment_expiry
from ..invoice import split_vat_inclusive, allocate_invoice_number
from ..logging import log
from ..coupons import (
    CouponError, CouponQuote, record_redemption, validate as validate_coupon,
)
from ..orders import (
    CartLineInput, materialise as materialise_order, quote as quote_order,
)
from ..models import (
    Coupon, Course, Enrollment, Lesson, LessonEntitlement, Order, OrderItem,
    Payment, SlipUpload, User,
)
from ..r2 import upload_bytes
from ..settings_db import get_payment_settings
from ..slipok import configured as slipok_configured, verify_slip

router = APIRouter(prefix="/api/v1", tags=["slip-payments"])

# Slip images are PNG/JPEG/WebP from a bank app screenshot. 4 MB caps any
# legitimate slip; anything bigger is almost certainly an attempted abuse.
MAX_SLIP_BYTES = 4 * 1024 * 1024
ALLOWED_TYPES = {"image/png", "image/jpeg", "image/webp"}


def _resolve_target(
    db: Session, course_slug: str | None, lesson_id: str | None,
) -> tuple[Course | None, Lesson | None, int]:
    """Return (course, lesson, expected_amount_baht). Exactly one of
    course/lesson is non-null on return."""
    if course_slug and lesson_id:
        raise HTTPException(400, "specify course_slug OR lesson_id, not both")
    if not course_slug and not lesson_id:
        raise HTTPException(400, "specify course_slug or lesson_id")

    if course_slug:
        course = db.scalar(select(Course).where(Course.slug == course_slug))
        if not course:
            raise HTTPException(404, "course not found")
        if course.price_baht <= 0:
            raise HTTPException(400, "course is free")
        return course, None, course.price_baht

    lesson = db.get(Lesson, lesson_id)
    if not lesson or (lesson.price_baht or 0) <= 0:
        raise HTTPException(404, "lesson not purchasable")
    return None, lesson, lesson.price_baht


def materialize_approval(
    db: Session, slip: SlipUpload, *, method: str, reviewed_by: uuid.UUID | None,
    note: str,
) -> Payment:
    """Create the Payment + Enrollment / LessonEntitlement for an approved slip.

    Caller is responsible for setting slip.status and committing. Idempotent
    by `slip.payment_id`: a second call short-circuits to the existing row."""
    if slip.payment_id:
        return db.get(Payment, slip.payment_id)

    # Multi-item path: enrolment / entitlement granted per OrderItem.
    order: Order | None = db.get(Order, slip.order_id) if slip.order_id else None

    subtotal, vat = split_vat_inclusive(slip.amount_baht)
    user = db.get(User, slip.user_id)
    # For multi-item orders we keep payments.course_id pointing to the FIRST
    # course in the order (or NULL if the order is lessons-only) — the
    # invoice/Payment row predates multi-item; the OrderItem rows carry the
    # full breakdown.
    legacy_course_id = slip.course_id
    if order is not None and legacy_course_id is None:
        for item in order.items:
            if item.course_id is not None:
                legacy_course_id = item.course_id
                break
    payment = Payment(
        user_id=slip.user_id,
        course_id=legacy_course_id or (
            db.get(Lesson, slip.lesson_id).course_id if slip.lesson_id else None
        ),
        stripe_session_id=None,
        amount_baht=slip.amount_baht,
        subtotal_baht=subtotal,
        vat_baht=vat,
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

    # If a coupon was applied at upload time, log the redemption now and bump
    # the global usage_count. Doing it on approval (not upload) means rejected
    # slips don't burn coupon stock.
    coupon_id_to_redeem = (order.coupon_id if order else None) or slip.coupon_id
    if coupon_id_to_redeem is not None:
        coupon = db.get(Coupon, coupon_id_to_redeem)
        if order is not None:
            original = order.subtotal_baht
            discount = order.discount_baht
            final = order.final_baht
        else:
            original = slip.original_amount_baht or slip.amount_baht
            final = slip.amount_baht
            discount = max(0, original - final)
        if coupon is not None:
            coupon.usage_count = (coupon.usage_count or 0) + 1
        from ..models import CouponRedemption
        db.add(CouponRedemption(
            coupon_id=coupon_id_to_redeem,
            user_id=slip.user_id,
            payment_id=payment.id,
            slip_upload_id=slip.id,
            order_id=order.id if order else None,
            original_baht=original,
            discount_baht=discount,
            final_baht=final,
        ))
        db.flush()

    if order is not None:
        for item in order.items:
            if item.course_id is not None:
                existing = db.scalar(select(Enrollment).where(
                    Enrollment.user_id == slip.user_id,
                    Enrollment.course_id == item.course_id,
                ))
                if not existing:
                    course = db.get(Course, item.course_id)
                    db.add(Enrollment(
                        user_id=slip.user_id, course_id=item.course_id,
                        expires_at=compute_enrollment_expiry(course) if course else None,
                    ))
            elif item.lesson_id is not None:
                existing = db.scalar(select(LessonEntitlement).where(
                    LessonEntitlement.user_id == slip.user_id,
                    LessonEntitlement.lesson_id == item.lesson_id,
                ))
                if not existing:
                    db.add(LessonEntitlement(
                        user_id=slip.user_id, lesson_id=item.lesson_id,
                    ))
        order.status = "paid"
    elif slip.course_id:
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
def slip_info(db: Session = Depends(get_session)):
    """Receiver bank info shown on the buyer page. No auth required —
    bank details aren't secret and the buyer needs them before login pays."""
    p = get_payment_settings(db)
    return {
        "bank_name": p.receiver_bank_name,
        "account_number": p.receiver_bank_account,
        "account_name": p.receiver_name,
        "promptpay_id": p.promptpay_id,
        "auto_verify": p.slipok_enabled,
    }


@router.post("/slip-payments/upload")
async def upload_slip(
    image: UploadFile = File(...),
    course_slug: str | None = Form(default=None),
    lesson_id: str | None = Form(default=None),
    coupon_code: str | None = Form(default=None),
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
):
    """Buyer uploads a transfer slip. On success the response tells the buyer
    whether they need to wait for manual review or playback was already
    unlocked (auto-verified by SlipOK)."""
    course, lesson, base_price = _resolve_target(db, course_slug, lesson_id)

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

    # Resolve coupon (if any) BEFORE writing the image — a bad code should
    # fail fast and cheap, not after R2 upload.
    quote: CouponQuote | None = None
    if coupon_code and coupon_code.strip():
        try:
            quote = validate_coupon(
                db, code=coupon_code, user_id=user.id, price_baht=base_price,
                course_id=course.id if course else None,
                lesson_id=lesson.id if lesson else None,
            )
        except CouponError as e:
            raise HTTPException(400, str(e))
    expected = quote.final_baht if quote else base_price

    # `final_baht == 0` means the coupon makes this completely free. Skip the
    # slip dance entirely — grant the entitlement directly.
    if expected <= 0:
        from ..models import CouponRedemption
        if course:
            db.add(Enrollment(
                user_id=user.id, course_id=course.id,
                expires_at=compute_enrollment_expiry(course),
            ))
        elif lesson:
            db.add(LessonEntitlement(user_id=user.id, lesson_id=lesson.id))
        if quote is not None:
            coupon = db.get(Coupon, quote.coupon_id)
            if coupon is not None:
                coupon.usage_count = (coupon.usage_count or 0) + 1
            db.add(CouponRedemption(
                coupon_id=quote.coupon_id, user_id=user.id,
                payment_id=None, slip_upload_id=None,
                original_baht=quote.original_baht,
                discount_baht=quote.discount_baht,
                final_baht=0,
            ))
        db.commit()
        return {
            "status": "auto_approved",
            "message": "ใช้คูปองสำเร็จ — เปิดสิทธิ์เรียนให้แล้ว",
            "slip_id": None,
        }

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
        amount_baht=expected,
        original_amount_baht=quote.original_baht if quote else None,
        coupon_id=quote.coupon_id if quote else None,
        r2_image_key=r2_key,
        status="pending",
    )
    db.add(slip)
    db.flush()

    result = await verify_slip(data, image.filename or "slip.jpg", expected, db)
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
        ) if slipok_configured(db) else (
            "ระบบได้รับสลิปแล้ว ทีมงานจะตรวจสอบและเปิดสิทธิ์ให้ภายใน 24 ชั่วโมง"
        ),
        "slip_id": str(slip.id),
    }


@router.post("/slip-payments/upload-order")
async def upload_slip_order(
    items_json: str = Form(...),
    coupon_code: str | None = Form(default=None),
    image: UploadFile | None = File(default=None),
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
):
    """Multi-item checkout: upload a single slip covering a cart of courses
    and/or purchasable lessons. Body is multipart with `items_json` =
    JSON list of {course_id?, lesson_id?}, optional `coupon_code`, and
    `image` (omit when the coupon makes the order free)."""
    try:
        raw = json.loads(items_json)
    except json.JSONDecodeError:
        raise HTTPException(400, "items_json ไม่ถูกต้อง")
    if not isinstance(raw, list) or not raw:
        raise HTTPException(400, "ตะกร้าว่าง")

    items: list[CartLineInput] = []
    for it in raw:
        if not isinstance(it, dict):
            raise HTTPException(400, "ตะกร้าผิดรูปแบบ")
        cid = it.get("course_id")
        lid = it.get("lesson_id")
        try:
            items.append(CartLineInput(
                course_id=uuid.UUID(cid) if cid else None,
                lesson_id=uuid.UUID(lid) if lid else None,
            ))
        except ValueError:
            raise HTTPException(400, "ตะกร้ามี id ที่ไม่ถูกต้อง")

    # Block items the buyer already owns — silently dropping would surprise
    # them; refusing tells them why.
    for it in items:
        if it.course_id and db.scalar(select(Enrollment).where(
            Enrollment.user_id == user.id, Enrollment.course_id == it.course_id,
        )):
            raise HTTPException(409, "มีคอร์สในตะกร้าที่คุณซื้อแล้ว — กรุณาลบออก")
        if it.lesson_id and db.scalar(select(LessonEntitlement).where(
            LessonEntitlement.user_id == user.id,
            LessonEntitlement.lesson_id == it.lesson_id,
        )):
            raise HTTPException(409, "มีบทเรียนในตะกร้าที่คุณซื้อแล้ว — กรุณาลบออก")

    try:
        q = quote_order(db, items, user_id=user.id, code=coupon_code)
    except CouponError as e:
        raise HTTPException(400, str(e))
    if coupon_code and coupon_code.strip() and q.coupon is None and q.coupon_reason:
        raise HTTPException(400, q.coupon_reason)

    order = materialise_order(db, user_id=user.id, quote_=q, status="awaiting")

    # Free order — grant immediately.
    if q.final_baht <= 0:
        slip = SlipUpload(
            user_id=user.id,
            order_id=order.id,
            amount_baht=0,
            original_amount_baht=q.subtotal_baht,
            coupon_id=q.coupon.coupon_id if q.coupon else None,
            r2_image_key="",  # no image needed
            status="auto_approved",
        )
        db.add(slip)
        db.flush()
        materialize_approval(
            db, slip, method="coupon_full", reviewed_by=None,
            note="full-discount coupon",
        )
        db.commit()
        return {
            "status": "auto_approved",
            "message": "ใช้คูปองสำเร็จ — เปิดสิทธิ์เรียนให้แล้ว",
            "slip_id": str(slip.id),
            "order_id": str(order.id),
        }

    if image is None:
        raise HTTPException(400, "ต้องแนบสลิป")
    if image.content_type not in ALLOWED_TYPES:
        raise HTTPException(415, f"unsupported image type {image.content_type}")
    data = await image.read()
    if len(data) > MAX_SLIP_BYTES:
        raise HTTPException(413, "slip too large")
    if len(data) < 256:
        raise HTTPException(400, "slip image too small to be real")

    suffix = (image.filename or "").rsplit(".", 1)[-1].lower() or "jpg"
    if suffix not in ("jpg", "jpeg", "png", "webp"):
        suffix = "jpg"
    r2_key = f"slips/{user.id}/{dt.datetime.utcnow():%Y/%m}/{secrets.token_hex(8)}.{suffix}"
    upload_bytes(r2_key, data, image.content_type)

    slip = SlipUpload(
        user_id=user.id,
        order_id=order.id,
        amount_baht=q.final_baht,
        original_amount_baht=q.subtotal_baht,
        coupon_id=q.coupon.coupon_id if q.coupon else None,
        r2_image_key=r2_key,
        status="pending",
    )
    db.add(slip)
    db.flush()

    result = await verify_slip(data, image.filename or "slip.jpg", q.final_baht, db)
    slip.verify_response = json.dumps(result.raw)[:8000] if result.raw else None
    if result.slip_ref:
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
            "order_id": str(order.id),
        }

    db.commit()
    log.info("slip_pending_review",
             slip_id=str(slip.id), target_user_id=str(user.id),
             order_id=str(order.id), reason=result.reason)
    return {
        "status": "pending",
        "message": (
            "ระบบยังตรวจสอบสลิปอัตโนมัติไม่ผ่าน "
            "ทีมงานจะตรวจสอบและเปิดสิทธิ์ให้ภายใน 24 ชั่วโมง"
        ) if slipok_configured(db) else (
            "ระบบได้รับสลิปแล้ว ทีมงานจะตรวจสอบและเปิดสิทธิ์ให้ภายใน 24 ชั่วโมง"
        ),
        "slip_id": str(slip.id),
        "order_id": str(order.id),
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
            "amount_baht": s.amount_baht,
            "status": s.status,
            "course_id": str(s.course_id) if s.course_id else None,
            "lesson_id": str(s.lesson_id) if s.lesson_id else None,
            "created_at": s.created_at.isoformat(),
            "reviewed_at": s.reviewed_at.isoformat() if s.reviewed_at else None,
        } for s in rows
    ]
