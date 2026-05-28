"""Coupon validation + redemption.

Single entrypoint for validating a code against a purchase context, and a
helper to record the redemption row. The slip-upload handler calls
`validate(...)` to compute the discounted amount, then `redeem(...)` after
the slip is approved (auto or manual) to bump usage_count + append the
audit row.

All amounts are whole baht.
"""
from __future__ import annotations

import datetime as dt
import uuid
from dataclasses import dataclass

from sqlalchemy import select, func
from sqlalchemy.orm import Session

from .models import Coupon, CouponRedemption


class CouponError(Exception):
    """Validation failure. The message is shown directly to the user, so
    keep it short and Thai-friendly."""


@dataclass(frozen=True)
class CouponQuote:
    coupon_id: uuid.UUID
    code: str
    original_baht: int
    discount_baht: int
    final_baht: int


def _normalise(code: str) -> str:
    return code.strip().upper()


def compute_discount(coupon: Coupon, price_baht: int) -> int:
    """Pure function: how much to subtract for this coupon at this price.
    Caller has already done scope + validity + limit checks."""
    if coupon.kind == "full":
        return price_baht
    if coupon.kind == "fixed":
        return min(coupon.amount_baht or 0, price_baht)
    if coupon.kind == "percent":
        raw = (price_baht * (coupon.percent or 0)) // 100
        if coupon.max_discount_baht is not None:
            raw = min(raw, coupon.max_discount_baht)
        return min(raw, price_baht)
    return 0


def validate(
    db: Session,
    *,
    code: str,
    user_id: uuid.UUID,
    price_baht: int,
    course_id: uuid.UUID | None = None,
    lesson_id: uuid.UUID | None = None,
) -> CouponQuote:
    """Resolve a code to a discount quote, or raise CouponError.

    Performs ALL of:
      - exact-match lookup (case-insensitive)
      - is_active
      - valid_from / valid_until window
      - scope vs. target (all / course / lesson)
      - min_purchase_baht
      - usage_limit (global) — counts current usage_count
      - per_user_limit — counts CouponRedemption rows for this user
    """
    norm = _normalise(code)
    if not norm:
        raise CouponError("กรุณากรอกโค้ดส่วนลด")

    coupon = db.scalar(select(Coupon).where(func.upper(Coupon.code) == norm))
    if not coupon:
        raise CouponError("ไม่พบโค้ดส่วนลดนี้")
    if not coupon.is_active:
        raise CouponError("โค้ดนี้ถูกปิดใช้งาน")

    now = dt.datetime.now(dt.timezone.utc)
    if coupon.valid_from and now < coupon.valid_from:
        raise CouponError("โค้ดนี้ยังไม่เริ่มใช้งาน")
    if coupon.valid_until and now > coupon.valid_until:
        raise CouponError("โค้ดนี้หมดอายุแล้ว")

    if coupon.scope == "course":
        if course_id is None or coupon.target_course_id != course_id:
            raise CouponError("โค้ดนี้ใช้ไม่ได้กับคอร์สที่เลือก")
    elif coupon.scope == "lesson":
        if lesson_id is None or coupon.target_lesson_id != lesson_id:
            raise CouponError("โค้ดนี้ใช้ไม่ได้กับบทเรียนที่เลือก")

    if price_baht < (coupon.min_purchase_baht or 0):
        raise CouponError(
            f"โค้ดนี้ใช้ได้เมื่อยอดซื้อตั้งแต่ {coupon.min_purchase_baht} บาทขึ้นไป"
        )

    if coupon.usage_limit is not None and coupon.usage_count >= coupon.usage_limit:
        raise CouponError("โค้ดนี้ถูกใช้ครบจำนวนแล้ว")

    if coupon.per_user_limit is not None:
        used = db.scalar(
            select(func.count()).select_from(CouponRedemption)
            .where(
                CouponRedemption.coupon_id == coupon.id,
                CouponRedemption.user_id == user_id,
            )
        ) or 0
        if used >= coupon.per_user_limit:
            raise CouponError("คุณใช้โค้ดนี้ครบจำนวนแล้ว")

    discount = compute_discount(coupon, price_baht)
    return CouponQuote(
        coupon_id=coupon.id,
        code=coupon.code,
        original_baht=price_baht,
        discount_baht=discount,
        final_baht=price_baht - discount,
    )


def record_redemption(
    db: Session,
    *,
    quote: CouponQuote,
    user_id: uuid.UUID,
    slip_upload_id: uuid.UUID | None = None,
    payment_id: uuid.UUID | None = None,
) -> CouponRedemption:
    """Bump usage_count + append the audit row. Caller commits."""
    coupon = db.get(Coupon, quote.coupon_id)
    if coupon is not None:
        coupon.usage_count = (coupon.usage_count or 0) + 1
    row = CouponRedemption(
        coupon_id=quote.coupon_id,
        user_id=user_id,
        slip_upload_id=slip_upload_id,
        payment_id=payment_id,
        original_baht=quote.original_baht,
        discount_baht=quote.discount_baht,
        final_baht=quote.final_baht,
    )
    db.add(row)
    db.flush()
    return row
