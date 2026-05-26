import datetime as dt
import jwt
from passlib.context import CryptContext
from .config import settings

pwd_ctx = CryptContext(schemes=["argon2"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_ctx.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return pwd_ctx.verify(password, hashed)


def create_jwt(user_id: str) -> str:
    now = dt.datetime.now(dt.timezone.utc)
    payload = {
        "sub": user_id,
        "iat": now,
        "exp": now + dt.timedelta(minutes=settings.JWT_TTL_MIN),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALG)


def decode_jwt(token: str) -> dict:
    return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALG])
