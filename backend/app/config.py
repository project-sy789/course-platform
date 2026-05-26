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
    CORS_ORIGINS: str = "https://app.example.com"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
