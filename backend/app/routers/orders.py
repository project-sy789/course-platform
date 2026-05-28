"""Cart pricing + order quote endpoint.

Frontend sends a cart (list of {course_id|lesson_id}) and an optional
coupon code; backend resolves prices, applies the coupon (with the
multi-item scope rules) and returns a per-line breakdown so the buyer
sees which items the coupon touched.
"""
from __future__ import annotations

import uuid
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_session
from ..deps import current_user
from ..models import User
from ..orders import CartLineInput, quote as quote_order


router = APIRouter(prefix="/api/v1", tags=["orders"])


class CartItemBody(BaseModel):
    course_id: uuid.UUID | None = None
    lesson_id: uuid.UUID | None = None


class CartQuoteBody(BaseModel):
    items: list[CartItemBody]
    code: str | None = None


class QuoteLineOut(BaseModel):
    course_id: uuid.UUID | None
    lesson_id: uuid.UUID | None
    title: str
    unit_price_baht: int
    line_discount_baht: int
    line_final_baht: int


class QuoteCouponOut(BaseModel):
    code: str
    discount_baht: int


class QuoteOut(BaseModel):
    lines: list[QuoteLineOut]
    subtotal_baht: int
    discount_baht: int
    final_baht: int
    coupon: QuoteCouponOut | None
    coupon_reason: str | None


@router.post("/orders/quote", response_model=QuoteOut)
def post_quote(
    body: CartQuoteBody,
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
):
    items = [
        CartLineInput(course_id=i.course_id, lesson_id=i.lesson_id)
        for i in body.items
    ]
    q = quote_order(db, items, user_id=user.id, code=body.code)
    return QuoteOut(
        lines=[
            QuoteLineOut(
                course_id=l.course_id, lesson_id=l.lesson_id, title=l.title,
                unit_price_baht=l.unit_price_baht,
                line_discount_baht=l.line_discount_baht,
                line_final_baht=l.line_final_baht,
            ) for l in q.lines
        ],
        subtotal_baht=q.subtotal_baht,
        discount_baht=q.discount_baht,
        final_baht=q.final_baht,
        coupon=QuoteCouponOut(code=q.coupon.code, discount_baht=q.coupon.discount_baht)
            if q.coupon else None,
        coupon_reason=q.coupon_reason,
    )
