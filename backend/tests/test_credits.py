"""Credit wallet tests (ระบบเหรียญ/โทเค็น)."""
from __future__ import annotations

import pytest
from sqlalchemy import select

from app.credits import apply_delta, get_balance, InsufficientCreditsError
from app.models import Course, CreditLedger, Enrollment, Lesson, LessonEntitlement

pytestmark = pytest.mark.asyncio


def test_apply_delta_creates_wallet_on_first_topup(db, make_user):
    user = make_user()
    apply_delta(db, user_id=user.id, delta_satang=10000, kind="topup")
    db.commit()
    assert get_balance(db, user.id) == 10000


def test_apply_delta_appends_ledger_and_updates_balance(db, make_user):
    user = make_user()
    apply_delta(db, user_id=user.id, delta_satang=10000, kind="topup")
    apply_delta(db, user_id=user.id, delta_satang=-3000, kind="spend", ref="course:x")
    db.commit()

    assert get_balance(db, user.id) == 7000
    rows = db.scalars(
        select(CreditLedger).where(CreditLedger.user_id == user.id)
        .order_by(CreditLedger.created_at.asc())
    ).all()
    assert len(rows) == 2
    assert [r.delta_satang for r in rows] == [10000, -3000]
    assert [r.balance_after_satang for r in rows] == [10000, 7000]


def test_apply_delta_refuses_to_go_negative(db, make_user):
    user = make_user()
    apply_delta(db, user_id=user.id, delta_satang=500, kind="topup")
    db.commit()
    with pytest.raises(InsufficientCreditsError):
        apply_delta(db, user_id=user.id, delta_satang=-1000, kind="spend")


async def test_balance_endpoint_returns_zero_for_new_user(client, make_user, auth_cookie):
    user = make_user()
    r = await client.get("/api/v1/credits/balance", cookies=auth_cookie(str(user.id)))
    assert r.status_code == 200
    assert r.json() == {"balance_satang": 0}


async def test_admin_topup_increases_balance(client, db, make_user, auth_cookie):
    admin = make_user("admin@example.com", is_admin=True)
    target = make_user("buyer@example.com")
    r = await client.post(
        "/api/v1/admin/credits/topup",
        cookies=auth_cookie(str(admin.id)),
        json={"user_email": "buyer@example.com", "satang": 50000, "note": "promo"},
    )
    assert r.status_code == 200
    assert r.json()["balance_satang"] == 50000


async def test_non_admin_cannot_topup(client, make_user, auth_cookie):
    user = make_user("buyer@example.com")
    r = await client.post(
        "/api/v1/admin/credits/topup",
        cookies=auth_cookie(str(user.id)),
        json={"user_email": "buyer@example.com", "satang": 1000},
    )
    assert r.status_code == 403


async def test_redeem_course_creates_enrollment_and_debits(
    client, db, make_user, auth_cookie,
):
    user = make_user("buyer@example.com")
    course = Course(slug="paid", title="Paid", price_cents=12000)
    db.add(course); db.commit()
    apply_delta(db, user_id=user.id, delta_satang=15000, kind="topup")
    db.commit()

    r = await client.post(
        f"/api/v1/credits/redeem-course/{course.slug}",
        cookies=auth_cookie(str(user.id)),
    )
    assert r.status_code == 200
    assert r.json()["balance_satang"] == 3000

    enr = db.scalar(select(Enrollment).where(Enrollment.user_id == user.id))
    assert enr is not None


async def test_redeem_course_rejects_insufficient_balance(
    client, db, make_user, auth_cookie,
):
    user = make_user("broke@example.com")
    course = Course(slug="paid", title="Paid", price_cents=12000)
    db.add(course); db.commit()
    apply_delta(db, user_id=user.id, delta_satang=1000, kind="topup")
    db.commit()

    r = await client.post(
        f"/api/v1/credits/redeem-course/{course.slug}",
        cookies=auth_cookie(str(user.id)),
    )
    assert r.status_code == 409
    # No enrollment, balance unchanged
    assert db.scalar(select(Enrollment).where(Enrollment.user_id == user.id)) is None
    assert get_balance(db, user.id) == 1000


async def test_redeem_lesson_creates_entitlement(
    client, db, make_user, make_video_with_key, auth_cookie,
):
    user = make_user("buyer@example.com")
    video, _ = make_video_with_key()
    lesson = db.scalar(select(Lesson).where(Lesson.video_id == video.id))
    lesson.price_cents = 5000
    db.commit()
    apply_delta(db, user_id=user.id, delta_satang=10000, kind="topup")
    db.commit()

    r = await client.post(
        f"/api/v1/credits/redeem-lesson/{lesson.id}",
        cookies=auth_cookie(str(user.id)),
    )
    assert r.status_code == 200
    assert r.json()["balance_satang"] == 5000
    assert db.scalar(select(LessonEntitlement).where(
        LessonEntitlement.user_id == user.id,
        LessonEntitlement.lesson_id == lesson.id,
    )) is not None
