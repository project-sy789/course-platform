"""Multi-item order pricing.

Given a cart (list of (course|lesson, price)) and an optional coupon code,
compute a per-line breakdown so the buyer sees exactly which items the
coupon touched. Used at quote time (cart preview) AND at slip-upload time
(freezing the breakdown into Order/OrderItem rows).

Coupon scope semantics on a multi-item order:
  - scope=all     — applies to the order subtotal. For percent kind we
                    distribute the resulting baht discount across lines
                    proportionally to each line's price so admins can see
                    where it landed; for fixed/full we still attribute to
                    the order header but distribute for display.
  - scope=course  — only lines whose course_id matches target_course_id.
                    Other lines get line_discount=0 even if the coupon
                    "would have applied".
  - scope=lesson  — only lines whose lesson_id matches target_lesson_id.

min_purchase_baht is checked against the *eligible* subtotal (matching
lines for scoped coupons; full subtotal for scope=all). This matches what
the buyer expects: "my course is 99฿ but the cart total is 600฿, why
isn't this 100฿-min coupon kicking in?" — answer: because the coupon is
scoped to that single course.
"""
from __future__ import annotations

import datetime as dt
import uuid
from dataclasses import dataclass

from sqlalchemy import select, func
from sqlalchemy.orm import Session

from .coupons import CouponError, CouponQuote, compute_discount
from .models import Coupon, CouponRedemption, Course, Lesson, Order, OrderItem


@dataclass(frozen=True)
class CartLineInput:
    """One line a buyer wants to checkout. Exactly one of course_id /
    lesson_id is set. The price is resolved server-side from the DB so
    buyers can't tamper with it."""
    course_id: uuid.UUID | None = None
    lesson_id: uuid.UUID | None = None


@dataclass(frozen=True)
class CartLine:
    course_id: uuid.UUID | None
    lesson_id: uuid.UUID | None
    title: str
    unit_price_baht: int
    line_discount_baht: int
    line_final_baht: int


@dataclass(frozen=True)
class OrderQuote:
    lines: list[CartLine]
    subtotal_baht: int
    discount_baht: int
    final_baht: int
    coupon: CouponQuote | None
    coupon_reason: str | None  # populated when a code was supplied but rejected


def resolve_lines(db: Session, items: list[CartLineInput]) -> list[CartLine]:
    """Look up each item, snapshot title + price. Raises CouponError-style
    string if any item is missing — we reuse CouponError so the upload
    handler can surface it as a single 400 reason."""
    if not items:
        raise CouponError("ตะกร้าว่าง")
    out: list[CartLine] = []
    for it in items:
        if (it.course_id is None) == (it.lesson_id is None):
            raise CouponError("ตะกร้าผิดรูปแบบ — แต่ละรายการต้องเป็นคอร์สหรือบทเรียนอย่างใดอย่างหนึ่ง")
        if it.course_id is not None:
            c = db.get(Course, it.course_id)
            if c is None:
                raise CouponError("ไม่พบคอร์สบางรายการในตะกร้า")
            out.append(CartLine(
                course_id=c.id, lesson_id=None,
                title=c.title, unit_price_baht=c.price_baht,
                line_discount_baht=0, line_final_baht=c.price_baht,
            ))
        else:
            le = db.get(Lesson, it.lesson_id)
            if le is None:
                raise CouponError("ไม่พบบทเรียนบางรายการในตะกร้า")
            if (le.price_baht or 0) <= 0:
                raise CouponError("บทเรียนนี้ไม่ได้เปิดขายแยก")
            out.append(CartLine(
                course_id=None, lesson_id=le.id,
                title=le.title, unit_price_baht=le.price_baht,
                line_discount_baht=0, line_final_baht=le.price_baht,
            ))
    return out


def _eligible_indices(coupon: Coupon, lines: list[CartLine]) -> list[int]:
    if coupon.scope == "all":
        return list(range(len(lines)))
    if coupon.scope == "course":
        return [i for i, l in enumerate(lines) if l.course_id == coupon.target_course_id]
    if coupon.scope == "lesson":
        return [i for i, l in enumerate(lines) if l.lesson_id == coupon.target_lesson_id]
    return []


def _apply_coupon(
    db: Session,
    coupon: Coupon,
    lines: list[CartLine],
    user_id: uuid.UUID,
) -> tuple[list[CartLine], int]:
    """Mutate-via-rebuild lines, return new lines + total discount.

    Validity / limit checks live here so the upload path and the cart-quote
    path share the same gate."""
    now = dt.datetime.now(dt.timezone.utc)
    if not coupon.is_active:
        raise CouponError("โค้ดนี้ถูกปิดใช้งาน")
    if coupon.valid_from and now < coupon.valid_from:
        raise CouponError("โค้ดนี้ยังไม่เริ่มใช้งาน")
    if coupon.valid_until and now > coupon.valid_until:
        raise CouponError("โค้ดนี้หมดอายุแล้ว")

    eligible = _eligible_indices(coupon, lines)
    if not eligible:
        if coupon.scope == "course":
            raise CouponError("โค้ดนี้ใช้ได้กับบางคอร์สเท่านั้น — ไม่มีคอร์สนั้นในตะกร้า")
        if coupon.scope == "lesson":
            raise CouponError("โค้ดนี้ใช้ได้กับบางบทเรียนเท่านั้น — ไม่มีบทนั้นในตะกร้า")
        raise CouponError("โค้ดนี้ใช้กับตะกร้านี้ไม่ได้")

    eligible_subtotal = sum(lines[i].unit_price_baht for i in eligible)
    if eligible_subtotal < (coupon.min_purchase_baht or 0):
        raise CouponError(
            f"โค้ดนี้ใช้ได้เมื่อยอด{('รายการที่เข้าเงื่อนไข' if coupon.scope != 'all' else '')}"
            f"ตั้งแต่ {coupon.min_purchase_baht} บาทขึ้นไป"
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

    # Compute total discount on the eligible subtotal, then distribute it
    # across eligible lines proportionally so each line records its share.
    total_discount = compute_discount(coupon, eligible_subtotal)
    if total_discount <= 0:
        return list(lines), 0

    # Largest-remainder rounding so the per-line shares sum to total_discount
    # exactly without floating-point drift.
    raw_shares = [
        (lines[i].unit_price_baht * total_discount) / eligible_subtotal
        for i in eligible
    ]
    floor_shares = [int(s) for s in raw_shares]
    remainder = total_discount - sum(floor_shares)
    # Hand out the leftover baht to the lines with the largest fractional parts.
    fracs = sorted(
        range(len(eligible)),
        key=lambda k: (raw_shares[k] - floor_shares[k]),
        reverse=True,
    )
    for k in fracs[:remainder]:
        floor_shares[k] += 1

    new_lines = list(lines)
    for k, idx in enumerate(eligible):
        share = floor_shares[k]
        l = new_lines[idx]
        new_lines[idx] = CartLine(
            course_id=l.course_id, lesson_id=l.lesson_id, title=l.title,
            unit_price_baht=l.unit_price_baht,
            line_discount_baht=share,
            line_final_baht=l.unit_price_baht - share,
        )
    return new_lines, total_discount


def quote(
    db: Session,
    items: list[CartLineInput],
    *,
    user_id: uuid.UUID,
    code: str | None,
) -> OrderQuote:
    """Price an unsubmitted cart. Cart is empty-rejected; coupon errors are
    surfaced via OrderQuote.coupon_reason (not raised) so the buyer can
    still proceed without the code."""
    lines = resolve_lines(db, items)
    subtotal = sum(l.unit_price_baht for l in lines)
    if not code or not code.strip():
        return OrderQuote(
            lines=lines, subtotal_baht=subtotal, discount_baht=0,
            final_baht=subtotal, coupon=None, coupon_reason=None,
        )

    norm = code.strip().upper()
    coupon = db.scalar(select(Coupon).where(func.upper(Coupon.code) == norm))
    if not coupon:
        return OrderQuote(
            lines=lines, subtotal_baht=subtotal, discount_baht=0,
            final_baht=subtotal, coupon=None,
            coupon_reason="ไม่พบโค้ดส่วนลดนี้",
        )

    try:
        new_lines, total_discount = _apply_coupon(db, coupon, lines, user_id)
    except CouponError as e:
        return OrderQuote(
            lines=lines, subtotal_baht=subtotal, discount_baht=0,
            final_baht=subtotal, coupon=None,
            coupon_reason=str(e),
        )

    final = subtotal - total_discount
    return OrderQuote(
        lines=new_lines,
        subtotal_baht=subtotal,
        discount_baht=total_discount,
        final_baht=final,
        coupon=CouponQuote(
            coupon_id=coupon.id, code=coupon.code,
            original_baht=subtotal,
            discount_baht=total_discount,
            final_baht=final,
        ),
        coupon_reason=None,
    )


def materialise(
    db: Session,
    *,
    user_id: uuid.UUID,
    quote_: OrderQuote,
    status: str = "awaiting",
) -> Order:
    """Persist a priced quote as an Order + OrderItem rows. Caller commits."""
    order = Order(
        user_id=user_id,
        status=status,
        subtotal_baht=quote_.subtotal_baht,
        discount_baht=quote_.discount_baht,
        final_baht=quote_.final_baht,
        coupon_id=quote_.coupon.coupon_id if quote_.coupon else None,
        coupon_code=quote_.coupon.code if quote_.coupon else None,
    )
    db.add(order)
    db.flush()
    for l in quote_.lines:
        db.add(OrderItem(
            order_id=order.id,
            course_id=l.course_id,
            lesson_id=l.lesson_id,
            title_snapshot=l.title,
            unit_price_baht=l.unit_price_baht,
            line_discount_baht=l.line_discount_baht,
            line_final_baht=l.line_final_baht,
        ))
    db.flush()
    return order
