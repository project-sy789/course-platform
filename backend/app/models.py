import uuid
from datetime import datetime
from sqlalchemy import (
    String, Text, Integer, Boolean, ForeignKey, BigInteger,
    LargeBinary, DateTime, UniqueConstraint, Index, func, false,
)
from sqlalchemy.dialects.postgresql import UUID, INET, CITEXT
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(CITEXT(), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    email_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Tax invoice (ใบกำกับภาษี) — optional. Filled in if the user wants invoices
    # made out to a company or to themselves with a 13-digit Thai tax ID.
    tax_name: Mapped[str | None] = mapped_column(Text)
    tax_id: Mapped[str | None] = mapped_column(Text)
    tax_address: Mapped[str | None] = mapped_column(Text)
    tax_branch: Mapped[str | None] = mapped_column(Text)  # "สำนักงานใหญ่" or branch code
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Course(Base):
    __tablename__ = "courses"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    price_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Time-limited access. NULL = lifetime (ขายขาด). Otherwise enrollments
    # created for this course expire at created_at + access_duration_days.
    access_duration_days: Mapped[int | None] = mapped_column(Integer)
    # Opt-in: render video frames to a <canvas> with the watermark drawn
    # directly into the pixel buffer instead of overlaying an absolutely-
    # positioned canvas. Survives screen recording / OBS but costs ~30%
    # more CPU and disables hardware video decode. Only worth it for
    # high-value courses; default off.
    pixel_watermark: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Video(Base):
    __tablename__ = "videos"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    r2_manifest_key: Mapped[str] = mapped_column(Text, nullable=False)
    duration_sec: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Lesson(Base):
    __tablename__ = "lessons"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    course_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id", ondelete="CASCADE"), nullable=False
    )
    video_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("videos.id"), nullable=False
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False)
    is_preview: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Optional per-lesson price (satang). 0 = bundled with course — must own the
    # whole course to unlock. >0 = sold individually as well (course enrollment
    # still unlocks it; this just opens a second purchase path).
    price_cents: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    __table_args__ = (UniqueConstraint("course_id", "position", name="uq_lesson_position"),)


class LessonEntitlement(Base):
    """Standalone unlock for a single lesson — bought without taking the
    whole course. Coexists with Enrollment: lesson access is granted by
    either a non-expired Enrollment OR a non-expired LessonEntitlement.

    Lifetime entitlements have expires_at = NULL, mirroring Enrollment."""
    __tablename__ = "lesson_entitlements"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    lesson_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("lessons.id", ondelete="CASCADE"), nullable=False
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "lesson_id", name="uq_lesson_entitlement"),
        Index("idx_lesson_entitlement_user", "user_id"),
    )


class VideoKey(Base):
    __tablename__ = "video_keys"
    video_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("videos.id", ondelete="CASCADE"), primary_key=True
    )
    key_ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    key_nonce: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    key_tag: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    kek_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Enrollment(Base):
    __tablename__ = "enrollments"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    course_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id", ondelete="CASCADE"), nullable=False
    )
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "course_id", name="uq_enroll_user_course"),
        Index("idx_enroll_user", "user_id"),
    )


class KeyAccessLog(Base):
    __tablename__ = "key_access_log"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"))
    video_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("videos.id"))
    ip: Mapped[str] = mapped_column(INET, nullable=False)
    user_agent: Mapped[str | None] = mapped_column(Text)
    granted: Mapped[bool] = mapped_column(Boolean, nullable=False)
    reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (Index("idx_kal_user_video", "user_id", "video_id", "created_at"),)


class EmailToken(Base):
    """Single-use tokens for email verification and password reset.

    `purpose` is "verify" or "reset". Tokens are stored as their SHA-256 hash;
    the raw token is sent to the user once via email and never persisted.
    """
    __tablename__ = "email_tokens"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    purpose: Mapped[str] = mapped_column(Text, nullable=False)
    token_hash: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("idx_email_tokens_hash", "token_hash"),
        Index("idx_email_tokens_user_purpose", "user_id", "purpose"),
    )


class Payment(Base):
    """Audit record of every Stripe checkout. Enrollment is created from this
    via the webhook — never trust the success-redirect alone."""
    __tablename__ = "payments"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    course_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id", ondelete="CASCADE"), nullable=False
    )
    stripe_session_id: Mapped[str | None] = mapped_column(Text, unique=True)
    stripe_payment_intent: Mapped[str | None] = mapped_column(Text)
    # When the payment came from a bank-transfer slip rather than Stripe.
    # Mutually exclusive in practice with stripe_session_id; both are nullable
    # so either rail can produce a Payment row.
    slip_upload_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("slip_uploads.id", ondelete="SET NULL")
    )
    payment_method: Mapped[str] = mapped_column(Text, nullable=False, default="stripe")
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    # VAT breakdown (Thai 7% VAT). amount_cents = subtotal_cents + vat_cents.
    # Computed at payment-creation time from the configured VAT_RATE so historic
    # invoices stay correct even if the rate changes later.
    subtotal_cents: Mapped[int | None] = mapped_column(Integer)
    vat_cents: Mapped[int | None] = mapped_column(Integer)
    # Sequential tax-invoice number (เลขที่ใบกำกับภาษี). Allocated only on
    # successful payment; remains NULL for pending/failed.
    invoice_number: Mapped[str | None] = mapped_column(Text, unique=True)
    # Snapshot of buyer tax info at the moment of issue — invoices must not
    # mutate when the user later changes their profile.
    buyer_tax_name: Mapped[str | None] = mapped_column(Text)
    buyer_tax_id: Mapped[str | None] = mapped_column(Text)
    buyer_tax_address: Mapped[str | None] = mapped_column(Text)
    buyer_tax_branch: Mapped[str | None] = mapped_column(Text)
    currency: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(Text, nullable=False)  # pending|paid|refunded|failed
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (Index("idx_payments_user_course", "user_id", "course_id"),)


class EncodeJob(Base):
    """Tracks a background ffmpeg encode of a raw upload into multi-bitrate HLS.

    State machine: pending -> running -> done | failed
    The arq worker picks up rows in 'pending', flips to 'running', shells out to
    encode_multibitrate.sh, then uploads the result and flips to 'done'.
    """
    __tablename__ = "encode_jobs"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    upload_id: Mapped[str] = mapped_column(Text, nullable=False)
    course_slug: Mapped[str] = mapped_column(Text, nullable=False)
    lesson_title: Mapped[str] = mapped_column(Text, nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    is_preview: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="pending")
    error: Mapped[str | None] = mapped_column(Text)
    video_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (Index("idx_encode_jobs_status", "status"),)


class LessonMaterial(Base):
    """A downloadable supplementary file attached to a lesson (PDF slides,
    worksheet, source code zip, etc.). The original file lives in R2 and is
    served through the API so we can stamp each download with the requesting
    user's identifier."""
    __tablename__ = "lesson_materials"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lesson_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("lessons.id", ondelete="CASCADE"), nullable=False
    )
    filename: Mapped[str] = mapped_column(Text, nullable=False)
    content_type: Mapped[str] = mapped_column(Text, nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    r2_key: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (Index("idx_lesson_materials_lesson", "lesson_id"),)


class MaterialDownloadLog(Base):
    """Audit trail of who downloaded which material. Combined with the per-file
    watermark, this gives us two independent ways to attribute a leaked file."""
    __tablename__ = "material_download_logs"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    material_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("lesson_materials.id", ondelete="CASCADE"), nullable=False
    )
    # Short opaque token embedded in the served file. If a copy shows up online
    # we look up this token and find which user/IP downloaded it when.
    watermark_id: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    ip: Mapped[str | None] = mapped_column(INET)
    user_agent: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("idx_mat_dl_logs_material", "material_id"),
        Index("idx_mat_dl_logs_user", "user_id"),
        Index("idx_mat_dl_logs_watermark", "watermark_id"),
    )


class LessonProgress(Base):
    """Per-user, per-lesson playback state.

    Resume-from-last-position uses `position_seconds`. Course completion
    summaries aggregate `completed=True` rows. We also keep a small history
    by writing to the audit log every time the position bumps significantly,
    but the primary state is right here — one row per (user, lesson)."""
    __tablename__ = "lesson_progress"
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    lesson_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("lessons.id", ondelete="CASCADE"), primary_key=True
    )
    position_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (Index("idx_lesson_progress_user", "user_id"),)


# ---------- Credit wallet (ระบบเหรียญ/โทเค็น) ----------
# A user's wallet balance lives in `credit_wallets` for fast reads. Every
# change is mirrored to an append-only `credit_ledger` so the balance can be
# audited / reconstructed and an admin reversal is just another ledger row.
# Both balance and ledger amounts are in satang to match course pricing.

class CreditWallet(Base):
    __tablename__ = "credit_wallets"
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    balance_satang: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class CreditLedger(Base):
    """Append-only history of every wallet movement.

    `kind` values:
      - "topup"   admin or future payment provider added credits
      - "spend"   user redeemed credits to unlock a course/lesson
      - "refund"  reversal of a previous spend
      - "adjust"  manual correction by an admin (positive or negative)
    """
    __tablename__ = "credit_ledger"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    delta_satang: Mapped[int] = mapped_column(Integer, nullable=False)
    balance_after_satang: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(Text, nullable=False)
    # Free-form pointer to the source: course_id, lesson_id, payment_id, or
    # a human note for manual adjustments. Not a FK because multiple targets.
    ref: Mapped[str | None] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(Text)
    actor_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("idx_credit_ledger_user_time", "user_id", "created_at"),
    )


# ---------- Anti-account-sharing: trusted devices ----------
# When a user logs in from an unrecognised device, the login is held until
# the user confirms a one-time code emailed to them. After confirmation the
# (user, device_hash) pair is added here and future logins from the same
# device skip the OTP step.
#
# `device_hash` is the SHA-256 of a client-generated UUID we set in
# localStorage on first visit (never the user agent — that rotates) plus a
# salt from settings, so a stolen localStorage value alone isn't enough.

class TrustedDevice(Base):
    __tablename__ = "trusted_devices"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    device_hash: Mapped[str] = mapped_column(Text, nullable=False)
    label: Mapped[str | None] = mapped_column(Text)  # ปกติเป็น UA-summary
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    last_ip: Mapped[str | None] = mapped_column(INET)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "device_hash", name="uq_trusted_device"),
        Index("idx_trusted_device_user", "user_id"),
    )


class LoginEvent(Base):
    """Append-only record of every login attempt.

    Powers impossible-travel detection (cheap: compare last successful
    login's IP /16 + country; if the next login is far away within an hour
    flag suspicious) and gives admin a clear forensic trail."""
    __tablename__ = "login_events"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    email_attempted: Mapped[str] = mapped_column(Text, nullable=False)
    ip: Mapped[str | None] = mapped_column(INET)
    user_agent: Mapped[str | None] = mapped_column(Text)
    device_hash: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(Text, nullable=False)  # ok|otp_required|bad_pw|locked
    suspicious: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    suspicion_reason: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("idx_login_events_user_time", "user_id", "created_at"),
    )


class SlipUpload(Base):
    """A bank-transfer slip uploaded by the buyer in lieu of card payment.

    Flow:
      1. User uploads slip image. Row created with status='pending'.
      2. If SLIPOK_API_KEY is configured the upload handler calls SlipOK,
         stores the JSON response in `verify_response`, and auto-approves on
         a successful match (amount + receiver account agree). Otherwise it
         stays 'pending' for admin review.
      3. Approving (auto or manual) creates the matching Enrollment +
         Payment row (so the existing invoice/tax pipeline still runs).

    Slips are kept even after approval — they're the legal record of the
    transfer for accounting + audit. R2 holds the image; DB holds metadata.
    """
    __tablename__ = "slip_uploads"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # Exactly one of course_id / lesson_id is set, mirroring the per-course
    # vs per-lesson purchase split. CHECK constraint below enforces that.
    course_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id", ondelete="SET NULL")
    )
    lesson_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("lessons.id", ondelete="SET NULL")
    )
    amount_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    r2_image_key: Mapped[str] = mapped_column(Text, nullable=False)
    # pending | auto_approved | admin_approved | rejected
    status: Mapped[str] = mapped_column(Text, nullable=False, default="pending")
    # SlipOK raw response (JSONB would be nicer; Text keeps the migration small).
    verify_response: Mapped[str | None] = mapped_column(Text)
    # Slip transaction reference (from SlipOK or admin-typed). Unique to make
    # accidental re-upload of the same slip caught by the DB.
    slip_ref: Mapped[str | None] = mapped_column(Text, unique=True)
    payment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("payments.id", ondelete="SET NULL")
    )
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_note: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("idx_slip_uploads_user", "user_id"),
        Index("idx_slip_uploads_status", "status"),
    )
