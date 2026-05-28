"""Buyer-facing payment list + tax invoice + admin manual refund.

Stripe has been removed in favour of the slip-upload flow (routers/slips.py).
This module now only owns:
  * GET /payments        — caller's own payment history
  * GET /payments/{id}/invoice — tax invoice PDF (ใบกำกับภาษี)
  * POST /admin/payments/{id}/refund — admin marks a payment refunded,
    removes the enrollment, and mass-revokes the buyer's JWTs so they
    cannot keep streaming. No external gateway is called — the actual
    money movement happens via bank transfer back, recorded separately.

The Payment row's stripe_session_id / stripe_payment_intent columns are
left in place so historical Stripe payments still render in /payments.
New payments come from slip uploads and leave those columns NULL.
"""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Response
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_redis, get_session
from ..deps import current_admin, current_user
from ..invoice import render_invoice_pdf
from ..logging import log
from ..models import Course, Enrollment, Payment, User

router = APIRouter(prefix="/api/v1", tags=["payments"])


async def _revoke_user_sessions(redis: Redis, user_id) -> None:
    """Mass-revoke every JWT this user holds. Used after refund so they
    can't keep streaming with their existing cookie."""
    cutoff = int(dt.datetime.now(dt.timezone.utc).timestamp())
    await redis.set(
        f"jwt:user_revoke:{user_id}", str(cutoff),
        ex=settings.JWT_TTL_MIN * 60,
    )


def _apply_refund(db: Session, payment: Payment) -> None:
    """Mark a payment refunded and remove the matching enrollment.

    Caller is responsible for revoking JWTs via Redis after this commits.
    Idempotent: safe to call twice.
    """
    if payment.status == "refunded":
        return
    payment.status = "refunded"
    enrollment = db.scalar(
        select(Enrollment).where(
            Enrollment.user_id == payment.user_id,
            Enrollment.course_id == payment.course_id,
        )
    )
    if enrollment:
        db.delete(enrollment)
    db.commit()
    log.info(
        "refund_applied",
        payment_id=str(payment.id),
        target_user_id=str(payment.user_id),
        course_id=str(payment.course_id),
    )


@router.post("/admin/payments/{payment_id}/refund")
async def admin_refund_payment(
    payment_id: str,
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
    redis: Redis = Depends(get_redis),
):
    """Mark a paid payment as refunded, revoke enrollment + JWTs.

    The money refund itself happens out-of-band (admin pushes the bank
    transfer back). This endpoint is the system-side bookkeeping +
    access revocation.
    """
    payment = db.get(Payment, payment_id)
    if not payment:
        raise HTTPException(404, "payment not found")
    if payment.status != "paid":
        raise HTTPException(409, f"payment not refundable (status={payment.status})")

    _apply_refund(db, payment)
    await _revoke_user_sessions(redis, payment.user_id)
    return {"ok": True}


@router.get("/payments")
def list_my_payments(
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
):
    rows = db.scalars(
        select(Payment).where(Payment.user_id == user.id).order_by(Payment.created_at.desc())
    ).all()
    return [
        {
            "id": str(p.id),
            "course_id": str(p.course_id),
            "amount_baht": p.amount_baht,
            "subtotal_baht": p.subtotal_baht,
            "vat_baht": p.vat_baht,
            "currency": p.currency,
            "status": p.status,
            "method": p.payment_method,
            "invoice_number": p.invoice_number,
            "created_at": p.created_at.isoformat(),
        } for p in rows
    ]


@router.get("/payments/{payment_id}/invoice")
def download_invoice(
    payment_id: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
):
    """Return the tax invoice PDF for one of the caller's payments."""
    payment = db.get(Payment, payment_id)
    if not payment:
        raise HTTPException(404, "payment not found")
    if payment.user_id != user.id and not user.is_admin:
        raise HTTPException(403, "not your payment")
    if payment.status != "paid" or not payment.invoice_number:
        raise HTTPException(409, "no invoice for unpaid payment")
    course = db.get(Course, payment.course_id)
    pdf = render_invoice_pdf(payment, course.title if course else "(course)")
    fname = f"{payment.invoice_number}.pdf"
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )
