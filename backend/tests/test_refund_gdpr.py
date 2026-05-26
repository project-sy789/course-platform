"""Refund + GDPR (account export/delete) tests.

Stripe API calls are monkey-patched. The webhook signature check is also
bypassed by patching `Webhook.construct_event` since signing in tests would
require a fake secret + signed payload — that's well-trodden code we trust.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models import Enrollment, Payment, User
from app.routers import payments as payments_router

pytestmark = pytest.mark.asyncio


def _seed_paid_payment(db, make_user, db_course=None):
    """Create user + course + enrollment + paid Payment with a known PI id."""
    from app.models import Course
    user = make_user("alice@example.com")
    course = db_course or Course(slug="paid", title="Paid", price_cents=2000)
    if not db_course:
        db.add(course); db.flush()
    db.add(Enrollment(user_id=user.id, course_id=course.id))
    payment = Payment(
        user_id=user.id, course_id=course.id,
        stripe_session_id="cs_test_123",
        stripe_payment_intent="pi_test_123",
        amount_cents=2000, currency="usd", status="paid",
    )
    db.add(payment); db.commit()
    return user, course, payment


async def test_admin_refund_revokes_enrollment_and_session(
    client, db, make_user, auth_cookie, monkeypatch
):
    admin = make_user("a@example.com", is_admin=True)
    user, course, payment = _seed_paid_payment(db, make_user)

    # Fake Stripe Refund.create
    calls = {}

    class FakeRefund:
        @staticmethod
        def create(payment_intent):
            calls["pi"] = payment_intent
            return {"id": "re_test_1"}

    fake_stripe = type("S", (), {"api_key": ""})()
    fake_stripe.Refund = FakeRefund
    monkeypatch.setattr(payments_router, "stripe", fake_stripe)
    monkeypatch.setattr(payments_router, "_stripe_client", lambda: fake_stripe)

    r = await client.post(
        f"/api/v1/admin/payments/{payment.id}/refund",
        cookies=auth_cookie(str(admin.id)),
    )
    assert r.status_code == 200
    assert calls["pi"] == "pi_test_123"

    db.refresh(payment)
    assert payment.status == "refunded"

    # Enrollment is gone
    enr = db.scalar(
        select(Enrollment).where(
            Enrollment.user_id == user.id, Enrollment.course_id == course.id
        )
    )
    assert enr is None

    # User's JWT cookies should now be rejected by current_user
    r = await client.get("/api/v1/auth/me", cookies=auth_cookie(str(user.id)))
    assert r.status_code == 401


async def test_admin_refund_only_for_admin(
    client, db, make_user, auth_cookie, monkeypatch
):
    student = make_user("s@example.com")
    user, _, payment = _seed_paid_payment(db, make_user)
    r = await client.post(
        f"/api/v1/admin/payments/{payment.id}/refund",
        cookies=auth_cookie(str(student.id)),
    )
    assert r.status_code == 403


async def test_admin_refund_rejects_non_paid(
    client, db, make_user, auth_cookie, monkeypatch
):
    from app.models import Course
    admin = make_user("a@example.com", is_admin=True)
    user = make_user("u@example.com")
    course = Course(slug="p", title="P", price_cents=1000)
    db.add(course); db.flush()
    pending = Payment(
        user_id=user.id, course_id=course.id, stripe_session_id="cs_pending",
        amount_cents=1000, currency="usd", status="pending",
    )
    db.add(pending); db.commit()

    r = await client.post(
        f"/api/v1/admin/payments/{pending.id}/refund",
        cookies=auth_cookie(str(admin.id)),
    )
    assert r.status_code == 409


async def test_stripe_charge_refunded_webhook_revokes(
    client, db, make_user, monkeypatch
):
    user, course, payment = _seed_paid_payment(db, make_user)

    fake_stripe = type("S", (), {"api_key": ""})()
    fake_stripe.Webhook = type("W", (), {})
    fake_stripe.Webhook.construct_event = staticmethod(lambda payload, sig, secret: {
        "type": "charge.refunded",
        "id": "evt_1",
        "data": {"object": {"payment_intent": "pi_test_123"}},
    })
    monkeypatch.setattr(payments_router, "stripe", fake_stripe)
    monkeypatch.setattr(payments_router, "_stripe_client", lambda: fake_stripe)
    monkeypatch.setattr(payments_router.settings, "STRIPE_WEBHOOK_SECRET", "whsec_fake")

    r = await client.post(
        "/api/v1/webhooks/stripe",
        headers={"stripe-signature": "ignored-by-mock"},
        content=b"{}",
    )
    assert r.status_code == 200
    db.refresh(payment)
    assert payment.status == "refunded"
    assert db.scalar(
        select(Enrollment).where(Enrollment.user_id == user.id)
    ) is None


# ---------- GDPR ----------

async def test_account_export_returns_user_data(
    client, db, make_user, auth_cookie
):
    user, _, _ = _seed_paid_payment(db, make_user)
    r = await client.get("/api/v1/account/export", cookies=auth_cookie(str(user.id)))
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["email"] == "alice@example.com"
    assert len(body["payments"]) == 1
    assert len(body["enrollments"]) == 1


async def test_account_delete_requires_email_confirmation(
    client, db, make_user, auth_cookie
):
    user = make_user("alice@example.com")
    r = await client.post(
        "/api/v1/account/delete",
        cookies=auth_cookie(str(user.id)),
        json={"confirm_email": "wrong@example.com"},
    )
    assert r.status_code == 400


async def test_account_delete_anonymizes_and_revokes(
    client, db, make_user, auth_cookie
):
    user, _, _ = _seed_paid_payment(db, make_user)
    cookies = auth_cookie(str(user.id))
    r = await client.post(
        "/api/v1/account/delete",
        cookies=cookies,
        json={"confirm_email": "alice@example.com"},
    )
    assert r.status_code == 200

    db.refresh(user)
    assert user.email.startswith("deleted-")
    assert user.email.endswith("@anonymized.local")
    assert user.is_active is False

    # Payments remain (accounting), enrollments are gone
    assert db.scalar(
        select(Enrollment).where(Enrollment.user_id == user.id)
    ) is None
    assert db.scalar(select(Payment).where(Payment.user_id == user.id)) is not None

    # Token revoked
    r = await client.get("/api/v1/auth/me", cookies=cookies)
    assert r.status_code == 401
