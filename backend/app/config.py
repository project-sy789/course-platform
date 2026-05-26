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
    KEK_BASE64: str
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

    # Email (SMTP). Use a transactional provider in production (Resend, Postmark, SES).
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = "no-reply@example.com"
    SMTP_USE_TLS: bool = True

    # Public-facing URL of the frontend, used in verification + reset links.
    FRONTEND_URL: str = "http://localhost:3000"

    # Stripe
    STRIPE_SECRET_KEY: str = ""
    STRIPE_WEBHOOK_SECRET: str = ""
    STRIPE_CURRENCY: str = "usd"

    CORS_ORIGINS: str = "https://app.example.com"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
