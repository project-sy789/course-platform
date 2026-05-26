"""Tax-invoice (ใบกำกับภาษี) tests."""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.models import Course, Payment, User
from app.invoice import split_vat_inclusive, allocate_invoice_number, render_invoice_pdf

pytestmark = pytest.mark.asyncio


def test_split_vat_inclusive_at_7pct():
    # 1070 satang inclusive at 7% → 1000 + 70.
    sub, vat = split_vat_inclusive(1070)
    assert sub + vat == 1070
    assert sub == 1000
    assert vat == 70


def test_split_vat_inclusive_handles_rounding():
    # 100 satang inclusive at 7% → ~93.46 + ~6.54 → 93 + 7 (residual).
    sub, vat = split_vat_inclusive(100)
    assert sub + vat == 100


def test_split_vat_zero_amount():
    sub, vat = split_vat_inclusive(0)
    assert sub == 0 and vat == 0


def test_allocate_invoice_number_is_sequential(db, make_user):
    user = make_user()
    course = Course(slug="c1", title="C", price_cents=10000)
    db.add(course); db.commit()

    n1 = allocate_invoice_number(db)
    db.add(Payment(
        user_id=user.id, course_id=course.id, stripe_session_id="cs_1",
        amount_cents=10000, currency="thb", status="paid", invoice_number=n1,
    )); db.commit()

    n2 = allocate_invoice_number(db)
    assert n1 != n2
    # Both should share the configured prefix and end in zero-padded digits.
    assert n1.split("-")[0] == n2.split("-")[0]


def test_render_invoice_pdf_returns_pdf_bytes(db, make_user):
    user = make_user(email="buyer@example.com")
    user.tax_name = "บริษัท ทดสอบ จำกัด"
    user.tax_id = "1234567890123"
    user.tax_address = "123 ถ.สุขุมวิท แขวงคลองตัน เขตคลองเตย กรุงเทพฯ 10110"
    course = Course(slug="c1", title="คอร์สทดสอบ", price_cents=10700)
    db.add(course); db.commit()

    sub, vat = split_vat_inclusive(course.price_cents)
    p = Payment(
        user_id=user.id, course_id=course.id, stripe_session_id="cs_2",
        amount_cents=course.price_cents, subtotal_cents=sub, vat_cents=vat,
        currency="thb", status="paid", invoice_number="INV-000001",
        buyer_tax_name=user.tax_name, buyer_tax_id=user.tax_id,
        buyer_tax_address=user.tax_address, buyer_tax_branch="สำนักงานใหญ่",
    )
    db.add(p); db.commit()

    pdf = render_invoice_pdf(p, course.title)
    assert pdf.startswith(b"%PDF-")
    assert len(pdf) > 1000


async def test_invoice_endpoint_requires_auth(client):
    r = await client.get("/api/v1/payments/00000000-0000-0000-0000-000000000000/invoice")
    assert r.status_code == 401


async def test_invoice_endpoint_rejects_other_users(client, db, make_user, auth_cookie):
    owner = make_user("owner@example.com")
    other = make_user("other@example.com")
    course = Course(slug="c1", title="C", price_cents=10000)
    db.add(course); db.commit()
    p = Payment(
        user_id=owner.id, course_id=course.id, stripe_session_id="cs_3",
        amount_cents=10000, subtotal_cents=9346, vat_cents=654,
        currency="thb", status="paid", invoice_number="INV-000002",
    )
    db.add(p); db.commit()

    r = await client.get(f"/api/v1/payments/{p.id}/invoice",
                         cookies=auth_cookie(str(other.id)))
    assert r.status_code == 403


async def test_invoice_endpoint_returns_pdf(client, db, make_user, auth_cookie):
    user = make_user("alice@example.com")
    course = Course(slug="c1", title="คอร์สทดสอบ", price_cents=10700)
    db.add(course); db.commit()
    p = Payment(
        user_id=user.id, course_id=course.id, stripe_session_id="cs_4",
        amount_cents=10700, subtotal_cents=10000, vat_cents=700,
        currency="thb", status="paid", invoice_number="INV-000003",
        buyer_tax_name="Alice", buyer_tax_id="1234567890123",
        buyer_tax_address="-", buyer_tax_branch="สำนักงานใหญ่",
    )
    db.add(p); db.commit()

    r = await client.get(f"/api/v1/payments/{p.id}/invoice",
                         cookies=auth_cookie(str(user.id)))
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/pdf"
    assert r.content.startswith(b"%PDF-")
