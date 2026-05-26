from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from redis.asyncio import Redis
from .config import settings

engine = create_engine(settings.DATABASE_URL, pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)

_redis: Redis = Redis.from_url(settings.REDIS_URL, decode_responses=True)


def get_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


async def get_redis() -> Redis:
    return _redis


def get_redis_singleton() -> Redis:
    """Sync accessor for non-Depends call sites (middleware). Same instance."""
    return _redis
