import uuid
from datetime import datetime
from sqlalchemy import (
    String, Text, Integer, SmallInteger, Boolean, ForeignKey, BigInteger,
    LargeBinary, DateTime, UniqueConstraint, Index, CheckConstraint, func, false,
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
    price_baht: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
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
    cover_image_key: Mapped[str | None] = mapped_column(Text)
    is_featured: Mapped[bool] = mapped_column(
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
    # Optional per-lesson price (whole baht). 0 = bundled with course — must own the
    # whole course to unlock. >0 = sold individually as well (course enrollment
    # still unlocks it; this just opens a second purchase path).
    price_baht: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

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
    payment_method: Mapped[str] = mapped_column(Text, nullable=False, default="slip_manual")
    amount_baht: Mapped[int] = mapped_column(Integer, nullable=False)
    # VAT breakdown (Thai 7% VAT). amount_baht = subtotal_baht + vat_baht.
    # Computed at payment-creation time from the configured VAT_RATE so historic
    # invoices stay correct even if the rate changes later.
    subtotal_baht: Mapped[int | None] = mapped_column(Integer)
    vat_baht: Mapped[int | None] = mapped_column(Integer)
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
    """A downloadable supplementary file. Scoped to *either* one lesson
    (`lesson_id` set) or the whole course (`course_id` set). The CHECK
    constraint enforces exactly-one — same shape `slip_uploads` uses for
    its course-or-lesson target."""
    __tablename__ = "lesson_materials"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    lesson_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("lessons.id", ondelete="CASCADE"), nullable=True
    )
    course_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id", ondelete="CASCADE"), nullable=True
    )
    filename: Mapped[str] = mapped_column(Text, nullable=False)
    content_type: Mapped[str] = mapped_column(Text, nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    r2_key: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("idx_lesson_materials_lesson", "lesson_id"),
        Index("idx_lesson_materials_course", "course_id"),
        CheckConstraint(
            "(course_id IS NULL) <> (lesson_id IS NULL)",
            name="ck_lesson_materials_scope",
        ),
    )


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
    # Multi-item path: slip is attached to an Order, which carries its own items.
    # Legacy single-item columns below are kept nullable for historical rows.
    order_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orders.id", ondelete="SET NULL")
    )
    # Legacy: exactly one of course_id / lesson_id was set, mirroring the per-
    # course vs per-lesson purchase split. New rows leave both NULL and use
    # order_id instead.
    course_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id", ondelete="SET NULL")
    )
    lesson_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("lessons.id", ondelete="SET NULL")
    )
    amount_baht: Mapped[int] = mapped_column(Integer, nullable=False)
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
    # Coupon applied at upload time, if any. Resolved into a CouponRedemption
    # row only on approval — bouncing or rejecting a slip leaves no audit dust.
    coupon_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("coupons.id", ondelete="SET NULL")
    )
    # Pre-discount price. NULL on slips uploaded without a coupon (in which
    # case original == amount_baht).
    original_amount_baht: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("idx_slip_uploads_user", "user_id"),
        Index("idx_slip_uploads_status", "status"),
    )


class AppSettings(Base):
    """Singleton row holding runtime-editable payment config.

    Each column is nullable. NULL = "fall back to .env" so an unconfigured
    deploy keeps using the env-var values; the admin UI overrides them
    per-field. The CHECK on id = 1 enforces the singleton at the DB level.
    """
    __tablename__ = "app_settings"
    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    receiver_bank_name: Mapped[str | None] = mapped_column(Text)
    receiver_bank_account: Mapped[str | None] = mapped_column(Text)
    receiver_name: Mapped[str | None] = mapped_column(Text)
    promptpay_id: Mapped[str | None] = mapped_column(Text)
    slipok_api_key: Mapped[str | None] = mapped_column(Text)
    slipok_branch_id: Mapped[str | None] = mapped_column(Text)
    # Email provider config — NULL on each = "fall back to .env". The provider
    # column picks the transport (smtp|resend|postmark|sendgrid|disabled);
    # email_api_key is the bearer/server token for HTTP-API providers and is
    # ignored when provider=smtp. email_from / email_from_name override
    # SMTP_FROM / EMAIL_FROM_NAME and apply to every provider.
    email_provider: Mapped[str | None] = mapped_column(Text)
    email_api_key: Mapped[str | None] = mapped_column(Text)
    email_from: Mapped[str | None] = mapped_column(Text)
    email_from_name: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(),
    )

    __table_args__ = (CheckConstraint("id = 1", name="ck_app_settings_singleton"),)


# ---------- Coupons ----------
# Admin-managed discount codes. A code is validated at checkout time, the
# discounted amount becomes the `expected` for the slip upload, and after
# approval a CouponRedemption row is appended for audit + per-user limits.
#
# Three kinds:
#   - "fixed"   subtract `amount_baht` from the price (clamped to 0)
#   - "percent" subtract round(price * percent / 100), optionally capped
#               by max_discount_baht
#   - "full"    100% off — used for comped enrollments / refund coupons
#
# Scope:
#   - "all"     applies to any course or lesson purchase
#   - "course"  only when target_course_id matches the purchased course
#   - "lesson"  only when target_lesson_id matches the purchased lesson


class Coupon(Base):
    __tablename__ = "coupons"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Stored uppercased for case-insensitive match. Unique at the DB level so
    # accidental duplicate codes raise IntegrityError on insert.
    code: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    kind: Mapped[str] = mapped_column(Text, nullable=False)  # fixed|percent|full

    amount_baht: Mapped[int | None] = mapped_column(Integer)        # for kind=fixed
    percent: Mapped[int | None] = mapped_column(SmallInteger)       # for kind=percent (1-100)
    max_discount_baht: Mapped[int | None] = mapped_column(Integer)  # cap for percent
    min_purchase_baht: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    scope: Mapped[str] = mapped_column(Text, nullable=False, default="all")  # all|course|lesson
    target_course_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id", ondelete="CASCADE")
    )
    target_lesson_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("lessons.id", ondelete="CASCADE")
    )

    valid_from: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    valid_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    usage_limit: Mapped[int | None] = mapped_column(Integer)    # null = unlimited globally
    per_user_limit: Mapped[int | None] = mapped_column(Integer) # null = unlimited per user
    usage_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    note: Mapped[str | None] = mapped_column(Text)              # admin-only label

    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    __table_args__ = (
        CheckConstraint(
            "kind IN ('fixed','percent','full')", name="ck_coupon_kind",
        ),
        CheckConstraint(
            "scope IN ('all','course','lesson')", name="ck_coupon_scope",
        ),
        # Targets must align with scope.
        CheckConstraint(
            "(scope = 'course' AND target_course_id IS NOT NULL AND target_lesson_id IS NULL) "
            "OR (scope = 'lesson' AND target_lesson_id IS NOT NULL AND target_course_id IS NULL) "
            "OR (scope = 'all' AND target_course_id IS NULL AND target_lesson_id IS NULL)",
            name="ck_coupon_target_scope",
        ),
        # Value field must align with kind.
        CheckConstraint(
            "(kind = 'fixed' AND amount_baht IS NOT NULL AND amount_baht > 0) "
            "OR (kind = 'percent' AND percent IS NOT NULL AND percent BETWEEN 1 AND 100) "
            "OR (kind = 'full')",
            name="ck_coupon_value",
        ),
        Index("idx_coupons_active", "is_active", "valid_until"),
    )


class CouponRedemption(Base):
    """Append-only log of every successful coupon use.

    Powers both the per-user limit check and the admin redemptions view. The
    payment_id is filled when materialise_approval creates the Payment, but
    the redemption row is written earlier (at slip-upload time) — so it can
    briefly point only to a slip. SET NULL on delete keeps history readable
    even if payments/slips are purged for GDPR."""
    __tablename__ = "coupon_redemptions"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    coupon_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("coupons.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    payment_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("payments.id", ondelete="SET NULL")
    )
    slip_upload_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("slip_uploads.id", ondelete="SET NULL")
    )
    order_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orders.id", ondelete="SET NULL")
    )
    original_baht: Mapped[int] = mapped_column(Integer, nullable=False)
    discount_baht: Mapped[int] = mapped_column(Integer, nullable=False)
    final_baht: Mapped[int] = mapped_column(Integer, nullable=False)
    redeemed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("idx_coupon_redemptions_coupon", "coupon_id"),
        Index("idx_coupon_redemptions_user", "user_id"),
    )


# ---------- Orders (multi-item checkout) ----------
# A buyer's cart materialises into an Order at the moment they submit their
# slip. The Order freezes the prices (`unit_price_baht` per item) so even if
# a course price changes later, the historical record stays correct.
#
# An Order may carry zero, one, or many courses *and* lessons. The slip's
# expected amount is the order's `final_baht` (subtotal − coupon discount).


class Order(Base):
    __tablename__ = "orders"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # pending  — slip not yet uploaded
    # awaiting — slip uploaded, awaiting verification (auto or admin)
    # paid     — slip approved, items granted
    # cancelled
    status: Mapped[str] = mapped_column(Text, nullable=False, default="pending")
    subtotal_baht: Mapped[int] = mapped_column(Integer, nullable=False)
    discount_baht: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    final_baht: Mapped[int] = mapped_column(Integer, nullable=False)
    coupon_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("coupons.id", ondelete="SET NULL")
    )
    coupon_code: Mapped[str | None] = mapped_column(Text)  # frozen snapshot
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    items: Mapped[list["OrderItem"]] = relationship(
        "OrderItem", back_populates="order", cascade="all, delete-orphan",
    )

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending','awaiting','paid','cancelled')",
            name="ck_order_status",
        ),
        Index("idx_orders_user_status", "user_id", "status"),
    )


class OrderItem(Base):
    __tablename__ = "order_items"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orders.id", ondelete="CASCADE"), nullable=False
    )
    # Exactly one of course_id / lesson_id is set per item.
    course_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("courses.id", ondelete="SET NULL")
    )
    lesson_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("lessons.id", ondelete="SET NULL")
    )
    title_snapshot: Mapped[str] = mapped_column(Text, nullable=False)
    unit_price_baht: Mapped[int] = mapped_column(Integer, nullable=False)
    line_discount_baht: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    line_final_baht: Mapped[int] = mapped_column(Integer, nullable=False)

    order: Mapped["Order"] = relationship("Order", back_populates="items")

    __table_args__ = (
        CheckConstraint(
            "(course_id IS NULL) <> (lesson_id IS NULL)",
            name="ck_order_item_target",
        ),
        Index("idx_order_items_order", "order_id"),
    )


# ---------- Admin audit log ----------
# Append-only ledger of every state-changing admin action. The dashboard /
# audit page renders this back as a forensic timeline. We log AFTER the DB
# commit succeeds so a rolled-back action leaves no trace.


class AdminAuditLog(Base):
    __tablename__ = "admin_audit_log"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL")
    )
    actor_email: Mapped[str | None] = mapped_column(Text)  # snapshot — survives user deletion
    action: Mapped[str] = mapped_column(Text, nullable=False)
    # Subject of the action — eg the user being suspended, the course being
    # edited. Free-form so the same table covers every admin touchpoint.
    target_type: Mapped[str | None] = mapped_column(Text)  # "user" | "course" | "coupon" | …
    target_id: Mapped[str | None] = mapped_column(Text)    # uuid OR slug, stored as text
    summary: Mapped[str] = mapped_column(Text, nullable=False)  # human-readable one-liner
    detail: Mapped[str | None] = mapped_column(Text)            # JSON blob for diffs/before-after
    ip: Mapped[str | None] = mapped_column(INET)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("idx_admin_audit_actor", "actor_id", "created_at"),
        Index("idx_admin_audit_target", "target_type", "target_id"),
        Index("idx_admin_audit_created", "created_at"),
    )

