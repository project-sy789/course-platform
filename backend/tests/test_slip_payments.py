"""Tests for the slip-upload payment flow.

Covers:
  * Anonymous upload → 401
  * Auto-approve path (SlipOK returns matching slip) → enrollment + payment created
  * Pending path (SlipOK disabled or no-match) → row stays pending, no enrollment
  * Admin approve → enrollment created idempotently
  * Admin reject → no enrollment, status=rejected
  * Already enrolled → 409
  * Duplicate slip_ref → 409
"""
from __future__ import annotations

from unittest.mock import patch

import pytest
from sqlalchemy import select

from app import slipok
from app.models import Enrollment, Payment, SlipUpload


pytestmark = pytest.mark.asyncio


def _make_course(db, price=99900):
    from app.models import Course
    c = Course(slug="c1", title="Course 1", price_cents=price)
    db.add(c); db.commit()
    return c


def _slipok_result(*, auto, ref="REF-123", amount=99900, reason="ok"):
    return slipok.SlipVerifyResult(
        ok=True, auto_approve=auto, raw={"data": {"transRef": ref}},
        slip_ref=ref, amount_satang=amount, receiver_account="xxx1234",
        reason=reason,
    )


async def test_anonymous_upload_rejected(client):
    r = await client.post("/api/v1/slip-payments/upload",
                          files={"image": ("s.jpg", b"x" * 1024, "image/jpeg")},
                          data={"course_slug": "c1"})
    assert r.status_code == 401


async def test_auto_approve_creates_enrollment_and_payment(
    client, db, make_user, auth_cookie,
):
    user = make_user("a@example.com")
    course = _make_course(db)

    with patch("app.routers.slips.verify_slip",
               return_value=_slipok_result(auto=True)), \
         patch("app.routers.slips.upload_bytes"):
        r = await client.post(
            "/api/v1/slip-payments/upload",
            cookies=auth_cookie(str(user.id)),
            files={"image": ("s.jpg", b"x" * 2048, "image/jpeg")},
            data={"course_slug": course.slug},
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "auto_approved"

    db.expire_all()
    assert db.scalar(select(Enrollment).where(
        Enrollment.user_id == user.id, Enrollment.course_id == course.id,
    )) is not None
    payment = db.scalar(select(Payment).where(Payment.user_id == user.id))
    assert payment.status == "paid"
    assert payment.payment_method == "slip_auto"
    assert payment.invoice_number  # invoice allocated


async def test_pending_does_not_enroll(client, db, make_user, auth_cookie):
    user = make_user("b@example.com")
    course = _make_course(db)

    with patch("app.routers.slips.verify_slip",
               return_value=_slipok_result(auto=False, reason="account_mismatch")), \
         patch("app.routers.slips.upload_bytes"):
        r = await client.post(
            "/api/v1/slip-payments/upload",
            cookies=auth_cookie(str(user.id)),
            files={"image": ("s.jpg", b"x" * 2048, "image/jpeg")},
            data={"course_slug": course.slug},
        )
    assert r.status_code == 200
    assert r.json()["status"] == "pending"
    db.expire_all()
    assert db.scalar(select(Enrollment).where(Enrollment.user_id == user.id)) is None
    slip = db.scalar(select(SlipUpload).where(SlipUpload.user_id == user.id))
    assert slip.status == "pending"


async def test_admin_approve_materializes_enrollment(
    client, db, make_user, auth_cookie,
):
    user = make_user("c@example.com")
    admin = make_user("admin@example.com", is_admin=True)
    course = _make_course(db)

    with patch("app.routers.slips.verify_slip",
               return_value=_slipok_result(auto=False)), \
         patch("app.routers.slips.upload_bytes"):
        up = await client.post(
            "/api/v1/slip-payments/upload",
            cookies=auth_cookie(str(user.id)),
            files={"image": ("s.jpg", b"x" * 2048, "image/jpeg")},
            data={"course_slug": course.slug},
        )
    slip_id = up.json()["slip_id"]

    r = await client.post(
        f"/api/v1/admin/slip-uploads/{slip_id}/approve",
        cookies=auth_cookie(str(admin.id)),
        json={"note": "checked manually"},
    )
    assert r.status_code == 200, r.text
    db.expire_all()
    assert db.scalar(select(Enrollment).where(
        Enrollment.user_id == user.id, Enrollment.course_id == course.id,
    )) is not None
    slip = db.get(SlipUpload, slip_id)
    assert slip.status == "admin_approved"
    payment = db.get(Payment, slip.payment_id)
    assert payment.payment_method == "slip_manual"


async def test_admin_reject_leaves_no_enrollment(
    client, db, make_user, auth_cookie,
):
    user = make_user("d@example.com")
    admin = make_user("admin2@example.com", is_admin=True)
    course = _make_course(db)

    with patch("app.routers.slips.verify_slip",
               return_value=_slipok_result(auto=False)), \
         patch("app.routers.slips.upload_bytes"):
        up = await client.post(
            "/api/v1/slip-payments/upload",
            cookies=auth_cookie(str(user.id)),
            files={"image": ("s.jpg", b"x" * 2048, "image/jpeg")},
            data={"course_slug": course.slug},
        )
    slip_id = up.json()["slip_id"]

    r = await client.post(
        f"/api/v1/admin/slip-uploads/{slip_id}/reject",
        cookies=auth_cookie(str(admin.id)),
        json={"note": "ยอดไม่ตรง"},
    )
    assert r.status_code == 200
    db.expire_all()
    assert db.scalar(select(Enrollment).where(Enrollment.user_id == user.id)) is None
    slip = db.get(SlipUpload, slip_id)
    assert slip.status == "rejected"
    assert slip.review_note == "ยอดไม่ตรง"


async def test_already_enrolled_blocks_upload(
    client, db, make_user, auth_cookie, enroll,
):
    user = make_user("e@example.com")
    course = _make_course(db)
    enroll(user, course.id)

    with patch("app.routers.slips.upload_bytes"):
        r = await client.post(
            "/api/v1/slip-payments/upload",
            cookies=auth_cookie(str(user.id)),
            files={"image": ("s.jpg", b"x" * 2048, "image/jpeg")},
            data={"course_slug": course.slug},
        )
    assert r.status_code == 409


async def test_duplicate_slip_ref_blocked(
    client, db, make_user, auth_cookie,
):
    a = make_user("f1@example.com")
    b = make_user("f2@example.com")
    course = _make_course(db)

    with patch("app.routers.slips.verify_slip",
               return_value=_slipok_result(auto=False, ref="DUP-1")), \
         patch("app.routers.slips.upload_bytes"):
        r1 = await client.post(
            "/api/v1/slip-payments/upload",
            cookies=auth_cookie(str(a.id)),
            files={"image": ("s.jpg", b"x" * 2048, "image/jpeg")},
            data={"course_slug": course.slug},
        )
        r2 = await client.post(
            "/api/v1/slip-payments/upload",
            cookies=auth_cookie(str(b.id)),
            files={"image": ("s.jpg", b"x" * 2048, "image/jpeg")},
            data={"course_slug": course.slug},
        )
    assert r1.status_code == 200
    assert r2.status_code == 409
