"""Runtime payment-config helper.

DB-backed admin-editable settings with `.env` fallback. Treat `app_settings`
as the source of truth; only fall back to `settings.*` when the column is
NULL. This way an unconfigured deploy keeps using its `.env`, and admins
can override per-field through the UI without redeploying.
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .models import AppSettings


@dataclass(frozen=True)
class PaymentSettings:
    receiver_bank_name: str
    receiver_bank_account: str
    receiver_name: str
    promptpay_id: str
    slipok_api_key: str
    slipok_branch_id: str

    @property
    def slipok_enabled(self) -> bool:
        return bool(self.slipok_api_key and self.slipok_branch_id)

    @property
    def receiver_bank_set(self) -> bool:
        return bool(self.receiver_bank_account)


# Allowed values for app_settings.email_provider (and EMAIL_PROVIDER env).
# Kept in sync with the dispatch table in email.py — adding a new transport
# means updating BOTH places. "disabled" is a deliberate no-op for dev/test.
EMAIL_PROVIDERS = ("smtp", "resend", "postmark", "sendgrid", "disabled")


@dataclass(frozen=True)
class EmailSettings:
    provider: str           # one of EMAIL_PROVIDERS
    api_key: str            # bearer/server token for HTTP-API providers
    from_email: str
    from_name: str
    # SMTP-only fields — read straight from env. We don't expose these in DB
    # because the admin path is "switch to a sender API" — keeping postfix
    # working should remain an env/deploy concern.
    smtp_host: str
    smtp_port: int
    smtp_user: str
    smtp_password: str
    smtp_use_tls: bool

    @property
    def configured(self) -> bool:
        """True when the chosen provider has the credentials it needs."""
        if self.provider == "disabled":
            return False
        if self.provider == "smtp":
            return bool(self.smtp_host)
        return bool(self.api_key)


def _row(db: Session) -> AppSettings:
    row = db.scalar(select(AppSettings).where(AppSettings.id == 1))
    if not row:
        # Migration always seeds id=1; if it's missing, materialize once
        # so callers never have to handle the absent-row case.
        row = AppSettings(id=1)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def _coalesce(db_value: str | None, env_value: str) -> str:
    return db_value if db_value is not None else env_value


def get_payment_settings(db: Session) -> PaymentSettings:
    r = _row(db)
    return PaymentSettings(
        receiver_bank_name=_coalesce(r.receiver_bank_name, settings.RECEIVER_BANK_NAME),
        receiver_bank_account=_coalesce(r.receiver_bank_account, settings.RECEIVER_BANK_ACCOUNT),
        receiver_name=_coalesce(r.receiver_name, settings.RECEIVER_NAME),
        promptpay_id=_coalesce(r.promptpay_id, settings.PROMPTPAY_ID),
        slipok_api_key=_coalesce(r.slipok_api_key, settings.SLIPOK_API_KEY),
        slipok_branch_id=_coalesce(r.slipok_branch_id, settings.SLIPOK_BRANCH_ID),
    )


def get_email_settings(db: Session) -> EmailSettings:
    r = _row(db)
    provider = _coalesce(r.email_provider, settings.EMAIL_PROVIDER).lower()
    if provider not in EMAIL_PROVIDERS:
        # Bad value in env / DB → treat as disabled so we don't crash on
        # every send. The settings page surfaces the misconfiguration.
        provider = "disabled"
    return EmailSettings(
        provider=provider,
        api_key=_coalesce(r.email_api_key, settings.EMAIL_API_KEY),
        from_email=_coalesce(r.email_from, settings.SMTP_FROM),
        from_name=_coalesce(r.email_from_name, settings.EMAIL_FROM_NAME),
        smtp_host=settings.SMTP_HOST,
        smtp_port=settings.SMTP_PORT,
        smtp_user=settings.SMTP_USER,
        smtp_password=settings.SMTP_PASSWORD,
        smtp_use_tls=settings.SMTP_USE_TLS,
    )


def update_email_settings(
    db: Session,
    *,
    provider: str | None = ...,         # type: ignore[assignment]
    api_key: str | None = ...,          # type: ignore[assignment]
    from_email: str | None = ...,       # type: ignore[assignment]
    from_name: str | None = ...,        # type: ignore[assignment]
) -> AppSettings:
    """Partial update, same Ellipsis-sentinel semantics as payment-settings.

    `provider` is validated against EMAIL_PROVIDERS — pass None to clear back
    to env. `api_key` follows the same "empty string = leave unchanged" UX
    convention as slipok_api_key in PaymentSettingsPatch."""
    r = _row(db)
    if provider is not ...:
        if provider is not None and provider not in EMAIL_PROVIDERS:
            raise ValueError(f"unknown email provider: {provider!r}")
        r.email_provider = provider
    if api_key is not ...:
        r.email_api_key = api_key
    if from_email is not ...:
        r.email_from = from_email
    if from_name is not ...:
        r.email_from_name = from_name
    db.commit()
    db.refresh(r)
    return r


def update_payment_settings(
    db: Session,
    *,
    receiver_bank_name: str | None = ...,  # type: ignore[assignment]
    receiver_bank_account: str | None = ...,  # type: ignore[assignment]
    receiver_name: str | None = ...,  # type: ignore[assignment]
    promptpay_id: str | None = ...,  # type: ignore[assignment]
    slipok_api_key: str | None = ...,  # type: ignore[assignment]
    slipok_branch_id: str | None = ...,  # type: ignore[assignment]
) -> AppSettings:
    """Update only fields the caller explicitly passed.

    Sentinel `...` (Ellipsis) = field not in payload → leave unchanged.
    Explicit `None` = clear back to env fallback. Empty string = store as
    empty (treat as 'set to nothing on purpose'). Callers should map their
    HTTP semantics onto these three states themselves.
    """
    r = _row(db)
    if receiver_bank_name is not ...:
        r.receiver_bank_name = receiver_bank_name
    if receiver_bank_account is not ...:
        r.receiver_bank_account = receiver_bank_account
    if receiver_name is not ...:
        r.receiver_name = receiver_name
    if promptpay_id is not ...:
        r.promptpay_id = promptpay_id
    if slipok_api_key is not ...:
        r.slipok_api_key = slipok_api_key
    if slipok_branch_id is not ...:
        r.slipok_branch_id = slipok_branch_id
    db.commit()
    db.refresh(r)
    return r
