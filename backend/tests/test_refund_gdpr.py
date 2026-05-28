"""Refund + GDPR (account export/delete) tests.

Stripe was removed in chunk 15 — admin refund is now a plain DB transition
plus JWT mass-revoke. The actual money refund is initiated out-of-band by
the operator.
"""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models import Enrollment, Payment


pytestmark = pytest.mark.asyncio


def _seed_paid_payment(db, make_user):
    """user + course + enrollment + a paid Payment row."""
    from app.models import Course
    user = make_user("alice@example.com")
    course = Course(slug="paid", title="Paid", price_baht=2000)
    db.add(course); db.flush()
    db.add(Enrollment(user_id=user.id, course_id=course.id))
    payment = Payment(
        user_id=user.id, course_id=course.id,
        amount_baht=2000, currency="thb", status="paid",
        payment_method="slip_manual",
    )
    db.add(payment); db.commit()
    return user, course, payment


async def test_admin_refund_revokes_enrollment_and_session(
    client, db, make_user, auth_cookie,
):
    admin = make_user("a@example.com", is_admin=True)
    user, course, payment = _seed_paid_payment(db, make_user)

    r = await client.post(
        f"/api/v1/admin/payments/{payment.id}/refund",
        cookies=auth_cookie(str(admin.id)),
    )
    assert r.status_code == 200, r.text

    db.refresh(payment)
    assert payment.status == "refunded"

    # Enrollment removed
    assert db.scalar(
        select(Enrollment).where(
            Enrollment.user_id == user.id, Enrollment.course_id == course.id
        )
    ) is None

    # User's JWT cookie now rejected by current_user (mass-revoke)
    r = await client.get("/api/v1/auth/me", cookies=auth_cookie(str(user.id)))
    assert r.status_code == 401


async def test_admin_refund_only_for_admin(
    client, db, make_user, auth_cookie,
):
    student = make_user("s@example.com")
    _, _, payment = _seed_paid_payment(db, make_user)
    r = await client.post(
        f"/api/v1/admin/payments/{payment.id}/refund",
        cookies=auth_cookie(str(student.id)),
    )
    assert r.status_code == 403


async def test_admin_refund_rejects_non_paid(
    client, db, make_user, auth_cookie,
):
    from app.models import Course
    admin = make_user("a@example.com", is_admin=True)
    user = make_user("u@example.com")
    course = Course(slug="p", title="P", price_baht=1000)
    db.add(course); db.flush()
    pending = Payment(
        user_id=user.id, course_id=course.id,
        amount_baht=1000, currency="thb", status="pending",
        payment_method="slip_manual",
    )
    db.add(pending); db.commit()

    r = await client.post(
        f"/api/v1/admin/payments/{pending.id}/refund",
        cookies=auth_cookie(str(admin.id)),
    )
    assert r.status_code == 409


# ---------- GDPR ----------

async def test_account_export_returns_user_data(
    client, db, make_user, auth_cookie,
):
    user, _, _ = _seed_paid_payment(db, make_user)
    r = await client.get("/api/v1/account/export", cookies=auth_cookie(str(user.id)))
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["email"] == "alice@example.com"
    assert len(body["payments"]) == 1
    assert len(body["enrollments"]) == 1


async def test_account_delete_requires_email_confirmation(
    client, db, make_user, auth_cookie,
):
    user = make_user("alice@example.com")
    r = await client.post(
        "/api/v1/account/delete",
        cookies=auth_cookie(str(user.id)),
        json={"confirm_email": "wrong@example.com"},
    )
    assert r.status_code == 400


async def test_account_delete_anonymizes_and_revokes(
    client, db, make_user, auth_cookie,
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

    # Payments remain (accounting); enrollments are gone
    assert db.scalar(
        select(Enrollment).where(Enrollment.user_id == user.id)
    ) is None
    assert db.scalar(select(Payment).where(Payment.user_id == user.id)) is not None

    # Token revoked
    r = await client.get("/api/v1/auth/me", cookies=cookies)
    assert r.status_code == 401
