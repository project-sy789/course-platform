"""Credit wallet endpoints.

Public (logged-in user):
  GET  /credits/balance               — current satang balance
  GET  /credits/ledger                — own ledger history (paginated)
  POST /credits/redeem-course/{slug}  — spend balance to enroll in a course
  POST /credits/redeem-lesson/{id}    — spend balance to entitle to a lesson

Admin:
  POST /admin/credits/topup           — add satang to a user's wallet
  POST /admin/credits/adjust          — arbitrary delta with a note (for refunds
                                         or manual fixes)
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..credits import apply_delta, get_balance, InsufficientCreditsError
from ..db import get_session
from ..deps import current_admin, current_user, compute_enrollment_expiry
from ..logging import log
from ..models import (
    Course, CreditLedger, Enrollment, Lesson, LessonEntitlement, User,
)


router = APIRouter(prefix="/api/v1", tags=["credits"])


# ---------- Buyer-facing ----------

@router.get("/credits/balance")
def my_balance(
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
):
    return {"balance_satang": get_balance(db, user.id)}


@router.get("/credits/ledger")
def my_ledger(
    user: User = Depends(current_user),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_session),
):
    rows = db.scalars(
        select(CreditLedger)
        .where(CreditLedger.user_id == user.id)
        .order_by(CreditLedger.created_at.desc())
        .limit(limit)
    ).all()
    return [
        {
            "id": str(r.id),
            "delta_satang": r.delta_satang,
            "balance_after_satang": r.balance_after_satang,
            "kind": r.kind,
            "ref": r.ref,
            "note": r.note,
            "created_at": r.created_at.isoformat(),
        } for r in rows
    ]


@router.post("/credits/redeem-course/{slug}")
def redeem_for_course(
    slug: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
):
    course = db.scalar(select(Course).where(Course.slug == slug))
    if not course:
        raise HTTPException(404, "course not found")
    if course.price_cents <= 0:
        raise HTTPException(409, "course is free — just enroll directly")

    existing = db.scalar(
        select(Enrollment).where(
            Enrollment.user_id == user.id, Enrollment.course_id == course.id
        )
    )
    if existing:
        raise HTTPException(409, "already enrolled")

    try:
        apply_delta(
            db, user_id=user.id, delta_satang=-course.price_cents,
            kind="spend", ref=f"course:{course.id}",
            note=f"redeem course {course.slug}",
        )
    except InsufficientCreditsError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e))

    enr = Enrollment(
        user_id=user.id, course_id=course.id,
        expires_at=compute_enrollment_expiry(course),
    )
    db.add(enr)
    db.commit()
    log.info("credits_redeem_course",
             course_slug=course.slug, satang=course.price_cents)
    return {"enrollment_id": str(enr.id), "balance_satang": get_balance(db, user.id)}


@router.post("/credits/redeem-lesson/{lesson_id}")
def redeem_for_lesson(
    lesson_id: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
):
    lesson = db.get(Lesson, lesson_id)
    if not lesson:
        raise HTTPException(404, "lesson not found")
    if lesson.price_cents <= 0:
        raise HTTPException(409, "lesson is not sold individually")

    existing = db.scalar(
        select(LessonEntitlement).where(
            LessonEntitlement.user_id == user.id,
            LessonEntitlement.lesson_id == lesson.id,
        )
    )
    if existing:
        raise HTTPException(409, "already entitled")

    try:
        apply_delta(
            db, user_id=user.id, delta_satang=-lesson.price_cents,
            kind="spend", ref=f"lesson:{lesson.id}",
            note=f"redeem lesson {lesson.title}",
        )
    except InsufficientCreditsError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e))

    ent = LessonEntitlement(user_id=user.id, lesson_id=lesson.id)
    db.add(ent)
    db.commit()
    log.info("credits_redeem_lesson",
             lesson_id=str(lesson.id), satang=lesson.price_cents)
    return {"entitlement_id": str(ent.id), "balance_satang": get_balance(db, user.id)}


# ---------- Admin ----------

class TopUpBody(BaseModel):
    user_email: EmailStr
    satang: int
    note: str | None = None


@router.post("/admin/credits/topup")
def admin_topup(
    body: TopUpBody,
    admin: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    if body.satang <= 0:
        raise HTTPException(422, "satang must be positive")
    target = db.scalar(select(User).where(User.email == body.user_email))
    if not target:
        raise HTTPException(404, "user not found")
    apply_delta(
        db, user_id=target.id, delta_satang=body.satang,
        kind="topup", note=body.note, actor_user_id=admin.id,
    )
    db.commit()
    log.info("credits_topup",
             target_user_id=str(target.id), satang=body.satang, actor=str(admin.id))
    return {"balance_satang": get_balance(db, target.id)}


class AdjustBody(BaseModel):
    user_email: EmailStr
    satang: int  # may be negative
    note: str


@router.post("/admin/credits/adjust")
def admin_adjust(
    body: AdjustBody,
    admin: User = Depends(current_admin),
    db: Session = Depends(get_session),
):
    target = db.scalar(select(User).where(User.email == body.user_email))
    if not target:
        raise HTTPException(404, "user not found")
    try:
        apply_delta(
            db, user_id=target.id, delta_satang=body.satang,
            kind="adjust", note=body.note, actor_user_id=admin.id,
        )
    except InsufficientCreditsError as e:
        raise HTTPException(409, str(e))
    db.commit()
    log.info("credits_adjust",
             target_user_id=str(target.id), satang=body.satang, actor=str(admin.id))
    return {"balance_satang": get_balance(db, target.id)}
