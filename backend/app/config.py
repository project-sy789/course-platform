from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str
    REDIS_URL: str
    JWT_SECRET: str
    JWT_ALG: str = "HS256"
    JWT_TTL_MIN: int = 60 * 24 * 7
    PB_SESSION_TTL_SEC: int = 300
    # Rate limit: max key fetches per (user, video) per minute. HLS w/ ~10s segments
    # legitimately fetches the same key once per ~50 min via cache; 30/min is generous.
    KEY_RATE_LIMIT_PER_MIN: int = 30
    # Max concurrent playback sessions a single user may hold across all videos.
    MAX_CONCURRENT_SESSIONS: int = 3
    KEK_BASE64: str = ""
    # Alternative to KEK_BASE64: path to a file whose contents are the
    # base64-encoded KEK. Preferred in production — pass via systemd
    # LoadCredential= or Docker secret so the key never appears in `env`,
    # `docker inspect`, or process listings. If both are set, the file wins.
    KEK_FILE: str = ""
    R2_PUBLIC_BASE: str

    # R2 admin upload credentials (only needed for /admin/* upload endpoints)
    R2_ACCOUNT_ID: str = ""
    R2_BUCKET: str = ""
    R2_ACCESS_KEY_ID: str = ""
    R2_SECRET_ACCESS_KEY: str = ""

    # AWS backup target (S3 Glacier Deep Archive). Optional.
    AWS_REGION: str = "ap-southeast-1"
    AWS_BACKUP_BUCKET: str = ""
    AWS_ACCESS_KEY_ID: str = ""
    AWS_SECRET_ACCESS_KEY: str = ""
    AWS_BACKUP_STORAGE_CLASS: str = "DEEP_ARCHIVE"

    # Email — provider-agnostic. EMAIL_PROVIDER picks the transport:
    #   smtp     — classic SMTP (Postfix in-cluster, or any external relay)
    #   resend   — Resend HTTP API   (header: Authorization: Bearer …)
    #   postmark — Postmark HTTP API (header: X-Postmark-Server-Token)
    #   sendgrid — SendGrid v3 HTTP API
    #   disabled — no-op (logs and returns); use in dev/test
    # Both env values are bootstrap defaults — admins can override per-field
    # in the DB (see app_settings.email_*) without redeploying.
    EMAIL_PROVIDER: str = "smtp"
    EMAIL_API_KEY: str = ""           # used by resend / postmark / sendgrid
    EMAIL_FROM_NAME: str = ""         # display name in the From header
    SMTP_HOST: str = "mailserver"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = "no-reply@example.com"
    SMTP_USE_TLS: bool = False  # in-cluster Postfix is plain; flip true for external relay

    # Public-facing URL of the frontend, used in verification + reset links.
    FRONTEND_URL: str = "http://localhost:3000"

    # Stripe is removed. Historic Payment rows keep their stripe_session_id /
    # stripe_payment_intent columns so old invoices still render, but no new
    # checkout sessions are minted — buyers use the slip-upload flow.
    # Currency stays here so the invoice PDF + checkout pages know what to print.
    STRIPE_CURRENCY: str = "thb"

    # Thai VAT (ภาษีมูลค่าเพิ่ม). Course prices are stored as the VAT-INCLUSIVE
    # amount in `price_baht` — at payment time we back-compute subtotal+vat
    # using this rate and freeze them on the Payment row. If Thailand changes
    # the standard rate, historic invoices still print whatever was frozen.
    VAT_RATE_PERCENT: float = 7.0

    # Issuer (seller) info that prints on every tax invoice (ใบกำกับภาษี).
    COMPANY_NAME: str = ""
    COMPANY_TAX_ID: str = ""
    COMPANY_ADDRESS: str = ""
    COMPANY_BRANCH: str = "สำนักงานใหญ่"
    COMPANY_PHONE: str = ""
    # Path inside the API container to a Thai-glyph TTF (Sarabun, Noto Sans Thai,
    # etc.). Must be reachable from the running uvicorn process. Leave empty to
    # fall back to Helvetica — Thai will render as boxes; fine for staging.
    INVOICE_FONT_PATH: str = ""
    # Prefix for the sequential invoice number, e.g. "INV2026" → "INV2026-000123".
    INVOICE_NUMBER_PREFIX: str = "INV"

    # Anti-account-sharing.
    # When enabled, login from an unrecognised device is held until the user
    # confirms a code emailed to them. Set the salt to a random secret —
    # rotating it invalidates all trust state and forces re-OTP everywhere.
    ANTI_SHARING_ENABLED: bool = True
    DEVICE_FINGERPRINT_SALT: str = "change-me-anti-sharing-salt"
    DEVICE_OTP_TTL_SEC: int = 600        # how long the emailed code is valid
    IMPOSSIBLE_TRAVEL_TTL_SEC: int = 3600  # window for IP-jump suspicion

    CORS_ORIGINS: str = "https://app.example.com"

    # ---------- Slip-upload payment ----------
    # Receiver bank info shown to the buyer on the slip-upload page.
    # PROMPTPAY_ID is optional — when set, the page renders a QR code for it.
    RECEIVER_BANK_NAME: str = ""
    RECEIVER_BANK_ACCOUNT: str = ""
    RECEIVER_NAME: str = ""
    PROMPTPAY_ID: str = ""
    # SlipOK API for automated slip verification. Leave SLIPOK_API_KEY empty
    # to disable auto-verify — every upload then waits for admin approval.
    # Endpoint format: https://api.slipok.com/api/line/apikey/{BRANCH_ID}
    SLIPOK_API_KEY: str = ""
    SLIPOK_BRANCH_ID: str = ""
    # Amount tolerance in baht. SlipOK returns the slip's transferred amount
    # and we require it >= price - tolerance. Banks sometimes round funny.
    SLIPOK_AMOUNT_TOLERANCE_BAHT: int = 0

    # End-to-end test bypass. Set ONLY in dev/CI; it exposes a route to
    # force-verify a user's email without going through SMTP. Production
    # must leave this empty (the route is then not registered at all).
    E2E_BYPASS_TOKEN: str = ""

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
