"""Stripe checkout + webhook + refund.

Flow:
  1. Authenticated user POSTs /checkout/session with {course_slug}
     → backend creates Stripe Checkout Session, records pending Payment row,
       returns the hosted checkout URL
  2. Stripe redirects user to /payment/success or /payment/cancel after pay
  3. Stripe hits /webhooks/stripe (signed) when the session is paid
     → backend verifies signature, marks Payment paid, creates Enrollment
     → Enrollment is created from the WEBHOOK only — never from the redirect.
  4. Refund: admin POSTs /admin/payments/{id}/refund or Stripe sends
     `charge.refunded`. Either path marks the Payment refunded, revokes the
     Enrollment, and mass-revokes the user's JWTs so they can't keep watching.
"""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.orm import Session
import stripe

from ..config import settings
from ..db import get_redis, get_session
from ..deps import current_admin, current_user, compute_enrollment_expiry
from ..logging import log
from ..models import Course, Enrollment, Payment, User

router = APIRouter(prefix="/api/v1", tags=["payments"])


def _stripe_client():
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Stripe not configured")
    stripe.api_key = settings.STRIPE_SECRET_KEY
    return stripe


async def _revoke_user_sessions(redis: Redis, user_id) -> None:
    """Mass-revoke every JWT this user holds. Used after refund so the
    user cannot keep streaming with their existing cookie."""
    cutoff = int(dt.datetime.now(dt.timezone.utc).timestamp())
    await redis.set(
        f"jwt:user_revoke:{user_id}", str(cutoff),
        ex=settings.JWT_TTL_MIN * 60,
    )


def _apply_refund(db: Session, payment: Payment) -> None:
    """Mark a payment refunded and remove the matching enrollment.

    Caller is responsible for revoking JWTs via Redis after this commits.
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


class CheckoutBody(BaseModel):
    course_slug: str


@router.post("/checkout/session")
def create_checkout_session(
    body: CheckoutBody,
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
):
    course = db.scalar(select(Course).where(Course.slug == body.course_slug))
    if not course:
        raise HTTPException(404, "course not found")
    if course.price_cents <= 0:
        raise HTTPException(400, "course is free — use admin enrollment grant")

    existing = db.scalar(
        select(Enrollment).where(
            Enrollment.user_id == user.id, Enrollment.course_id == course.id
        )
    )
    if existing:
        raise HTTPException(409, "already enrolled")

    sc = _stripe_client()
    session_obj = sc.checkout.Session.create(
        mode="payment",
        customer_email=user.email,
        line_items=[{
            "quantity": 1,
            "price_data": {
                "currency": settings.STRIPE_CURRENCY,
                "unit_amount": course.price_cents,
                "product_data": {
                    "name": course.title,
                    "description": (course.description or "")[:500],
                },
            },
        }],
        success_url=f"{settings.FRONTEND_URL}/payment/success?session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{settings.FRONTEND_URL}/payment/cancel",
        client_reference_id=str(user.id),
        metadata={"user_id": str(user.id), "course_id": str(course.id)},
    )

    db.add(Payment(
        user_id=user.id,
        course_id=course.id,
        stripe_session_id=session_obj["id"],
        amount_cents=course.price_cents,
        currency=settings.STRIPE_CURRENCY,
        status="pending",
    ))
    db.commit()

    log.info("checkout_created", target_user_id=str(user.id),
             course_slug=course.slug, session_id=session_obj["id"])
    return {"checkout_url": session_obj["url"], "session_id": session_obj["id"]}


@router.post("/webhooks/stripe", include_in_schema=False)
async def stripe_webhook(
    request: Request,
    db: Session = Depends(get_session),
    redis: Redis = Depends(get_redis),
):
    sc = _stripe_client()
    if not settings.STRIPE_WEBHOOK_SECRET:
        raise HTTPException(503, "STRIPE_WEBHOOK_SECRET not configured")

    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    try:
        event = sc.Webhook.construct_event(payload, sig, settings.STRIPE_WEBHOOK_SECRET)
    except (ValueError, sc.error.SignatureVerificationError) as e:  # type: ignore[attr-defined]
        log.warning("stripe_webhook_invalid", error=str(e))
        raise HTTPException(400, "bad signature")

    etype = event["type"]
    log.info("stripe_webhook", event_type=etype, event_id=event.get("id"))

    if etype == "checkout.session.completed":
        session_obj = event["data"]["object"]
        session_id = session_obj["id"]
        payment = db.scalar(select(Payment).where(Payment.stripe_session_id == session_id))
        if not payment:
            log.warning("stripe_webhook_unknown_session", session_id=session_id)
            return {"ok": True}  # idempotent ack
        if payment.status == "paid":
            return {"ok": True}

        payment.status = "paid"
        payment.stripe_payment_intent = session_obj.get("payment_intent")

        existing = db.scalar(
            select(Enrollment).where(
                Enrollment.user_id == payment.user_id,
                Enrollment.course_id == payment.course_id,
            )
        )
        if not existing:
            course = db.get(Course, payment.course_id)
            db.add(Enrollment(
                user_id=payment.user_id,
                course_id=payment.course_id,
                expires_at=compute_enrollment_expiry(course) if course else None,
            ))
        db.commit()
        log.info("enrollment_created_from_payment",
                 target_user_id=str(payment.user_id), course_id=str(payment.course_id))

    elif etype in ("charge.refunded", "charge.refund.updated"):
        # `charge.refunded` carries the charge object, not a checkout session.
        # Match by payment_intent (stripe sends `payment_intent` on the charge).
        charge = event["data"]["object"]
        pi = charge.get("payment_intent")
        if not pi:
            return {"ok": True}
        payment = db.scalar(select(Payment).where(Payment.stripe_payment_intent == pi))
        if payment:
            _apply_refund(db, payment)
            await _revoke_user_sessions(redis, payment.user_id)

    elif etype in ("checkout.session.expired", "payment_intent.payment_failed"):
        obj = event["data"]["object"]
        session_id = obj.get("id")
        if session_id:
            payment = db.scalar(select(Payment).where(Payment.stripe_session_id == session_id))
            if payment and payment.status == "pending":
                payment.status = "failed"
                db.commit()

    return {"ok": True}


# ---------- Admin-initiated refund ----------

@router.post("/admin/payments/{payment_id}/refund")
async def admin_refund_payment(
    payment_id: str,
    _: User = Depends(current_admin),
    db: Session = Depends(get_session),
    redis: Redis = Depends(get_redis),
):
    """Issue a refund through Stripe and revoke the enrollment + sessions.

    Stripe's `charge.refunded` webhook will also fire — `_apply_refund` is
    idempotent so duplicate processing is safe.
    """
    payment = db.get(Payment, payment_id)
    if not payment:
        raise HTTPException(404, "payment not found")
    if payment.status != "paid":
        raise HTTPException(409, f"payment not refundable (status={payment.status})")
    if not payment.stripe_payment_intent:
        raise HTTPException(409, "payment has no Stripe payment_intent")

    sc = _stripe_client()
    refund = sc.Refund.create(payment_intent=payment.stripe_payment_intent)
    log.info("admin_refund", payment_id=payment_id, refund_id=refund.get("id"))

    _apply_refund(db, payment)
    await _revoke_user_sessions(redis, payment.user_id)
    return {"ok": True, "refund_id": refund.get("id")}
