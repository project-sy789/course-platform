"""Account self-service: data export + deletion (GDPR / PDPA).

Two user-facing endpoints:
  GET  /api/v1/account/export    — JSON dump of every record tied to this user
  POST /api/v1/account/delete    — anonymize the user record + cascade purges

We anonymize rather than hard-delete so referenced rows (payments, key
access logs) keep their structure for accounting/forensics. Email is
hashed-then-truncated so the same person re-registering in the future
gets a fresh account, and reverse lookup of the original is impossible.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import secrets

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from redis.asyncio import Redis
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_redis, get_session
from ..deps import current_user
from ..logging import log
from ..models import (
    Enrollment, KeyAccessLog, LessonProgress, MaterialDownloadLog,
    Payment, User,
)

router = APIRouter(prefix="/api/v1/account", tags=["account"])


# ---------- Tax-invoice profile (ใบกำกับภาษี) ----------

class TaxInfoOut(BaseModel):
    tax_name: str | None = None
    tax_id: str | None = None
    tax_address: str | None = None
    tax_branch: str | None = None


class TaxInfoIn(BaseModel):
    # All optional — POSTing every field as null clears the profile.
    tax_name: str | None = None
    tax_id: str | None = None
    tax_address: str | None = None
    tax_branch: str | None = None


@router.get("/tax-info", response_model=TaxInfoOut)
def get_tax_info(user: User = Depends(current_user)):
    return TaxInfoOut(
        tax_name=user.tax_name, tax_id=user.tax_id,
        tax_address=user.tax_address, tax_branch=user.tax_branch,
    )


@router.put("/tax-info", response_model=TaxInfoOut)
def update_tax_info(
    body: TaxInfoIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
):
    """Update buyer-side tax info. Only fields that pass the cheap shape
    checks here ride through; Thai TIN is exactly 13 digits."""
    if body.tax_id is not None and body.tax_id.strip():
        tid = body.tax_id.strip()
        if not (tid.isdigit() and len(tid) == 13):
            raise HTTPException(422, "tax_id must be 13 digits")
        body.tax_id = tid
    user.tax_name = body.tax_name or None
    user.tax_id = body.tax_id or None
    user.tax_address = body.tax_address or None
    user.tax_branch = body.tax_branch or None
    db.commit()
    return TaxInfoOut(**body.model_dump())


@router.get("/export")
def export_my_data(
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
):
    """Right-of-access dump. Plain JSON, no compression — the volume per user
    is small (kilobytes, not megabytes). Sensitive credentials are not
    included."""
    payments = db.scalars(select(Payment).where(Payment.user_id == user.id)).all()
    enrollments = db.scalars(select(Enrollment).where(Enrollment.user_id == user.id)).all()
    progress = db.scalars(select(LessonProgress).where(LessonProgress.user_id == user.id)).all()
    downloads = db.scalars(
        select(MaterialDownloadLog).where(MaterialDownloadLog.user_id == user.id)
    ).all()
    key_logs = db.scalars(
        select(KeyAccessLog).where(KeyAccessLog.user_id == user.id)
        .order_by(KeyAccessLog.created_at.desc()).limit(1000)
    ).all()

    return {
        "user": {
            "id": str(user.id),
            "email": user.email,
            "is_active": user.is_active,
            "is_admin": user.is_admin,
            "email_verified": user.email_verified,
            "created_at": user.created_at.isoformat(),
        },
        "enrollments": [
            {"course_id": str(e.course_id), "created_at": e.created_at.isoformat()}
            for e in enrollments
        ],
        "payments": [
            {
                "id": str(p.id),
                "course_id": str(p.course_id),
                "amount_cents": p.amount_cents,
                "currency": p.currency,
                "status": p.status,
                "stripe_session_id": p.stripe_session_id,
                "created_at": p.created_at.isoformat(),
            } for p in payments
        ],
        "lesson_progress": [
            {
                "lesson_id": str(p.lesson_id),
                "position_seconds": p.position_seconds,
                "duration_seconds": p.duration_seconds,
                "completed": p.completed,
                "updated_at": p.updated_at.isoformat(),
            } for p in progress
        ],
        "material_downloads": [
            {
                "material_id": str(d.material_id),
                "watermark_id": d.watermark_id,
                "ip": str(d.ip) if d.ip else None,
                "user_agent": d.user_agent,
                "created_at": d.created_at.isoformat(),
            } for d in downloads
        ],
        "key_access_log_recent": [
            {
                "video_id": str(k.video_id),
                "ip": str(k.ip) if k.ip else None,
                "granted": k.granted,
                "reason": k.reason,
                "created_at": k.created_at.isoformat(),
            } for k in key_logs
        ],
    }


class DeleteBody(BaseModel):
    # Require the user to type their email — it's the standard "are you sure"
    # for irreversible destructive actions.
    confirm_email: str


@router.post("/delete")
async def delete_my_account(
    body: DeleteBody,
    response: Response,
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
    redis: Redis = Depends(get_redis),
):
    """Anonymize the user. Their PII is replaced with an opaque tombstone;
    payment / log rows that reference them keep working for accounting but
    no longer point at a real identity.

    Why not hard-delete: refund disputes can come months later and we still
    need the Payment row. Hard-delete also breaks the watermark forensics
    chain. Anonymization satisfies the GDPR "right to erasure" requirement
    while keeping financial records intact.
    """
    if body.confirm_email.strip().lower() != user.email.strip().lower():
        raise HTTPException(400, "confirm_email must match your account email")

    # Replace email with a non-reversible marker. Hash the original so a
    # support engineer can later confirm "yes this was the same person",
    # but reversing it back to the email is impractical.
    salted = (settings.JWT_SECRET + user.email).encode()
    digest = hashlib.sha256(salted).hexdigest()[:16]
    placeholder = f"deleted-{digest}-{secrets.token_hex(4)}@anonymized.local"

    db.execute(
        update(User).where(User.id == user.id).values(
            email=placeholder,
            password_hash="!disabled",  # argon2 verify will always fail
            is_active=False,
            email_verified=False,
        )
    )
    # Hard-delete data that is unambiguously personal and serves no
    # business-record purpose:
    db.execute(delete(LessonProgress).where(LessonProgress.user_id == user.id))
    db.execute(delete(Enrollment).where(Enrollment.user_id == user.id))
    db.commit()

    # Revoke every existing JWT for this user.
    cutoff = int(dt.datetime.now(dt.timezone.utc).timestamp())
    await redis.set(
        f"jwt:user_revoke:{user.id}", str(cutoff),
        ex=settings.JWT_TTL_MIN * 60,
    )

    response.delete_cookie("session", path="/")
    log.info("account_deleted", target_user_id=str(user.id))
    return {"ok": True}
