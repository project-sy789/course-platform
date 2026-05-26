"""Stripe checkout + webhook.

Flow:
  1. Authenticated user POSTs /checkout/session with {course_slug}
     → backend creates Stripe Checkout Session, records pending Payment row,
       returns the hosted checkout URL
  2. Stripe redirects user to /payment/success or /payment/cancel after pay
  3. Stripe hits /webhooks/stripe (signed) when the session is paid
     → backend verifies signature, marks Payment paid, creates Enrollment
     → Enrollment is created from the WEBHOOK only — never from the redirect.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session
import stripe

from ..config import settings
from ..db import get_session
from ..deps import current_user
from ..logging import log
from ..models import Course, Enrollment, Payment, User

router = APIRouter(prefix="/api/v1", tags=["payments"])


def _stripe_client():
    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Stripe not configured")
    stripe.api_key = settings.STRIPE_SECRET_KEY
    return stripe


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
async def stripe_webhook(request: Request, db: Session = Depends(get_session)):
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
            return {"ok": True}  # idempotent: ack so Stripe stops retrying
        if payment.status == "paid":
            return {"ok": True}  # idempotent

        payment.status = "paid"
        payment.stripe_payment_intent = session_obj.get("payment_intent")

        existing = db.scalar(
            select(Enrollment).where(
                Enrollment.user_id == payment.user_id,
                Enrollment.course_id == payment.course_id,
            )
        )
        if not existing:
            db.add(Enrollment(user_id=payment.user_id, course_id=payment.course_id))
        db.commit()
        log.info("enrollment_created_from_payment",
                 target_user_id=str(payment.user_id), course_id=str(payment.course_id))

    elif etype in ("charge.refunded", "checkout.session.expired",
                   "payment_intent.payment_failed"):
        # Best-effort: mark payment failed/refunded; don't auto-revoke enrollment
        # for refunds — that's a manual policy decision.
        obj = event["data"]["object"]
        session_id = obj.get("id") if etype != "charge.refunded" else None
        if session_id:
            payment = db.scalar(select(Payment).where(Payment.stripe_session_id == session_id))
            if payment:
                payment.status = "failed" if etype != "charge.refunded" else "refunded"
                db.commit()

    return {"ok": True}
