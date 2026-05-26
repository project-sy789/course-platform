import datetime as dt
import secrets
import jwt
from passlib.context import CryptContext
from .config import settings

pwd_ctx = CryptContext(schemes=["argon2"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_ctx.hash(password)


def verify_password(password: str, hashed: str) -> bool:
    return pwd_ctx.verify(password, hashed)


def create_jwt(user_id: str) -> str:
    """Issue a JWT with a random `jti` so individual tokens can be revoked.

    Revocation is done by adding the jti to a Redis denylist with a TTL equal
    to the token's remaining lifetime. Stateless verification stays the
    common-case fast path; only revoked tokens hit the deny check.
    """
    now = dt.datetime.now(dt.timezone.utc)
    payload = {
        "sub": user_id,
        "iat": now,
        "exp": now + dt.timedelta(minutes=settings.JWT_TTL_MIN),
        "jti": secrets.token_urlsafe(16),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALG)


def decode_jwt(token: str) -> dict:
    return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALG])


def jwt_remaining_seconds(payload: dict) -> int:
    """Seconds until the JWT expires, clamped to >=0."""
    exp = payload.get("exp")
    if not exp:
        return 0
    return max(0, int(exp - dt.datetime.now(dt.timezone.utc).timestamp()))

