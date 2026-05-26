from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str
    REDIS_URL: str
    JWT_SECRET: str
    JWT_ALG: str = "HS256"
    JWT_TTL_MIN: int = 60 * 24 * 7
    PB_SESSION_TTL_SEC: int = 300
    KEK_BASE64: str
    R2_PUBLIC_BASE: str

    # R2 admin upload credentials (only needed for /admin/* upload endpoints)
    R2_ACCOUNT_ID: str = ""
    R2_BUCKET: str = ""
    R2_ACCESS_KEY_ID: str = ""
    R2_SECRET_ACCESS_KEY: str = ""

    CORS_ORIGINS: str = "https://app.example.com"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
