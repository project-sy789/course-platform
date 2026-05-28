"""Coupon endpoints — public validation + admin CRUD.

Public:
  POST /coupons/validate     check a code, return discount quote (no redemption)

Admin (under /admin):
  GET    /admin/coupons              list with filters
  POST   /admin/coupons              create
  PATCH  /admin/coupons/{id}         partial update
  DELETE /admin/coupons/{id}         soft delete (is_active=false)
  GET    /admin/coupons/{id}/redemptions   audit history for one coupon
"""
from __future__ import annotations

import datetime as dt
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..coupons import CouponError, _normalise, validate as validate_coupon
from ..db import get_session
from ..deps import current_user, current_admin
from ..logging import log
from ..models import Coupon, CouponRedemption, Course, Lesson, User


router = APIRouter(prefix="/api/v1", tags=["coupons"])


# ---------- Public ----------

class ValidateIn(BaseModel):
    code: str
    course_slug: Optional[str] = None
    lesson_id: Optional[str] = None


@router.post("/coupons/validate")
def coupons_validate(
    body: ValidateIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
):
    """Check whether a coupon applies to the given course or lesson and
    return the discounted total. Does NOT redeem — that happens at slip
    approval."""
    if (body.course_slug and body.lesson_id) or (not body.course_slug and not body.lesson_id):
        raise HTTPException(400, "specify course_slug OR lesson_id")

    course_id: uuid.UUID | None = None
    lesson_id: uuid.UUID | None = None
    price_baht: int

    if body.course_slug:
        course = db.scalar(select(Course).where(Course.slug == body.course_slug))
        if not course:
            raise HTTPException(404, "course not found")
        course_id = course.id
        price_baht = course.price_baht
    else:
        lesson = db.get(Lesson, body.lesson_id)
        if not lesson:
            raise HTTPException(404, "lesson not found")
        lesson_id = lesson.id
        price_baht = lesson.price_baht or 0

    if price_baht <= 0:
        raise HTTPException(400, "this item is free — no coupon needed")

    try:
        quote = validate_coupon(
            db, code=body.code, user_id=user.id, price_baht=price_baht,
            course_id=course_id, lesson_id=lesson_id,
        )
    except CouponError as e:
        return {"valid": False, "reason": str(e)}

    return {
        "valid": True,
        "code": quote.code,
        "original_baht": quote.original_baht,
        "discount_baht": quote.discount_baht,
        "final_baht": quote.final_baht,
    }


# ---------- Admin ----------

class CouponIn(BaseModel):
    code: str
    kind: str  # fixed|percent|full
    amount_baht: Optional[int] = None
    percent: Optional[int] = None
    max_discount_baht: Optional[int] = None
    min_purchase_baht: int = 0
    scope: str = "all"  # all|course|lesson
    target_course_slug: Optional[str] = None
    target_lesson_id: Optional[str] = None
    valid_from: Optional[dt.datetime] = None
    valid_until: Optional[dt.datetime] = None
    usage_limit: Optional[int] = None
    per_user_limit: Optional[int] = None
    is_active: bool = True
    note: Optional[str] = None


class CouponPatch(BaseModel):
    kind: Optional[str] = None
    amount_baht: Optional[int] = None
    percent: Optional[int] = None
    max_discount_baht: Optional[int] = None
    min_purchase_baht: Optional[int] = None
    scope: Optional[str] = None
    target_course_slug: Optional[str] = None
    target_lesson_id: Optional[str] = None
    valid_from: Optional[dt.datetime] = None
    valid_until: Optional[dt.datetime] = None
    usage_limit: Optional[int] = None
    per_user_limit: Optional[int] = None
    is_active: Optional[bool] = None
    note: Optional[str] = None


def _serialize(c: Coupon, db: Session) -> dict:
    target_course_slug = None
    target_lesson_title = None
    if c.target_course_id:
        course = db.get(Course, c.target_course_id)
        target_course_slug = course.slug if course else None
    if c.target_lesson_id:
        lesson = db.get(Lesson, c.target_lesson_id)
        target_lesson_title = lesson.title if lesson else None
    return {
        "id": str(c.id),
        "code": c.code,
        "kind": c.kind,
        "amount_baht": c.amount_baht,
        "percent": c.percent,
        "max_discount_baht": c.max_discount_baht,
        "min_purchase_baht": c.min_purchase_baht,
        "scope": c.scope,
        "target_course_id": str(c.target_course_id) if c.target_course_id else None,
        "target_course_slug": target_course_slug,
        "target_lesson_id": str(c.target_lesson_id) if c.target_lesson_id else None,
        "target_lesson_title": target_lesson_title,
        "valid_from": c.valid_from.isoformat() if c.valid_from else None,
        "valid_until": c.valid_until.isoformat() if c.valid_until else None,
        "usage_limit": c.usage_limit,
        "per_user_limit": c.per_user_limit,
        "usage_count": c.usage_count,
        "is_active": c.is_active,
        "note": c.note,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


def _resolve_targets(
    db: Session, scope: str, course_slug: str | None, lesson_id: str | None,
) -> tuple[uuid.UUID | None, uuid.UUID | None]:
    if scope == "all":
        return None, None
    if scope == "course":
        if not course_slug:
            raise HTTPException(400, "scope=course requires target_course_slug")
        course = db.scalar(select(Course).where(Course.slug == course_slug))
        if not course:
            raise HTTPException(404, f"course {course_slug} not found")
        return course.id, None
    if scope == "lesson":
        if not lesson_id:
            raise HTTPException(400, "scope=lesson requires target_lesson_id")
        lesson = db.get(Lesson, lesson_id)
        if not lesson:
            raise HTTPException(404, "lesson not found")
        return None, lesson.id
    raise HTTPException(400, f"invalid scope: {scope}")


@router.get("/admin/coupons")
def admin_list_coupons(
    active_only: bool = False,
    admin: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    q = select(Coupon).order_by(desc(Coupon.created_at))
    if active_only:
        q = q.where(Coupon.is_active.is_(True))
    rows = db.scalars(q).all()
    return [_serialize(c, db) for c in rows]


@router.post("/admin/coupons")
def admin_create_coupon(
    body: CouponIn,
    admin: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    code = _normalise(body.code)
    if not code:
        raise HTTPException(422, "code required")
    target_course_id, target_lesson_id = _resolve_targets(
        db, body.scope, body.target_course_slug, body.target_lesson_id,
    )
    coupon = Coupon(
        code=code,
        kind=body.kind,
        amount_baht=body.amount_baht,
        percent=body.percent,
        max_discount_baht=body.max_discount_baht,
        min_purchase_baht=body.min_purchase_baht or 0,
        scope=body.scope,
        target_course_id=target_course_id,
        target_lesson_id=target_lesson_id,
        valid_from=body.valid_from,
        valid_until=body.valid_until,
        usage_limit=body.usage_limit,
        per_user_limit=body.per_user_limit,
        is_active=body.is_active,
        note=body.note,
        created_by=admin.id,
    )
    db.add(coupon)
    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        msg = str(e.orig) if e.orig else str(e)
        if "unique" in msg.lower() or "duplicate" in msg.lower():
            raise HTTPException(409, "โค้ดนี้มีอยู่แล้ว")
        if "ck_coupon" in msg:
            raise HTTPException(422, f"ค่าคูปองไม่ถูกต้อง: {msg}")
        raise
    log.info("coupon_created", coupon_id=str(coupon.id), code=coupon.code,
             actor=str(admin.id))
    return _serialize(coupon, db)


@router.patch("/admin/coupons/{coupon_id}")
def admin_update_coupon(
    coupon_id: str,
    body: CouponPatch,
    admin: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    coupon = db.get(Coupon, coupon_id)
    if not coupon:
        raise HTTPException(404, "coupon not found")

    data = body.model_dump(exclude_unset=True)

    # Targets follow scope. If scope changes, re-resolve targets; if scope
    # didn't change but the slug/lesson_id did, also re-resolve.
    new_scope = data.get("scope", coupon.scope)
    if "scope" in data or "target_course_slug" in data or "target_lesson_id" in data:
        course_slug = data.get("target_course_slug")
        lesson_id = data.get("target_lesson_id")
        target_course_id, target_lesson_id = _resolve_targets(
            db, new_scope, course_slug, lesson_id,
        )
        coupon.scope = new_scope
        coupon.target_course_id = target_course_id
        coupon.target_lesson_id = target_lesson_id

    for f in (
        "kind", "amount_baht", "percent", "max_discount_baht",
        "min_purchase_baht", "valid_from", "valid_until",
        "usage_limit", "per_user_limit", "is_active", "note",
    ):
        if f in data:
            setattr(coupon, f, data[f])

    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        raise HTTPException(422, f"ค่าคูปองไม่ถูกต้อง: {e.orig}")
    return _serialize(coupon, db)


@router.delete("/admin/coupons/{coupon_id}")
def admin_delete_coupon(
    coupon_id: str,
    admin: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    """Soft delete — sets is_active=false. Keeps redemption history intact.
    To hard-delete (and cascade redemptions), the admin can DELETE … FROM
    psql directly; we don't expose that."""
    coupon = db.get(Coupon, coupon_id)
    if not coupon:
        raise HTTPException(404, "coupon not found")
    coupon.is_active = False
    db.commit()
    log.info("coupon_deactivated", coupon_id=str(coupon.id), actor=str(admin.id))
    return {"ok": True}


@router.get("/admin/coupons/{coupon_id}/redemptions")
def admin_coupon_redemptions(
    coupon_id: str,
    admin: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    coupon = db.get(Coupon, coupon_id)
    if not coupon:
        raise HTTPException(404, "coupon not found")
    rows = db.scalars(
        select(CouponRedemption)
        .where(CouponRedemption.coupon_id == coupon.id)
        .order_by(desc(CouponRedemption.redeemed_at))
    ).all()
    return [
        {
            "id": str(r.id),
            "user_id": str(r.user_id),
            "user_email": (db.get(User, r.user_id).email if db.get(User, r.user_id) else None),
            "payment_id": str(r.payment_id) if r.payment_id else None,
            "slip_upload_id": str(r.slip_upload_id) if r.slip_upload_id else None,
            "original_baht": r.original_baht,
            "discount_baht": r.discount_baht,
            "final_baht": r.final_baht,
            "redeemed_at": r.redeemed_at.isoformat(),
        }
        for r in rows
    ]
