"""Anti-account-sharing helpers.

Three layers, layered so each one alone is bypassable but combined they
make casual reselling painful:

  1. Device fingerprint
     The frontend sets a random UUID in `localStorage` on first visit and
     sends it as the `X-Device-Id` header on every auth call. We hash it
     with a server-side salt before storage so a leaked DB row + leaked
     localStorage UUID still aren't enough to forge trust without the salt.

  2. Email OTP on new device
     Login from a (user, device_hash) pair we haven't seen succeed before
     does NOT mint a session. Instead a 6-digit code is mailed to the
     account and stashed in Redis (TTL 10 min). Confirming the code
     promotes the device to `trusted_devices` and *then* the cookie
     drops. Reseller gets the password but not the inbox → no access.

  3. Impossible-travel suspicion
     We remember the last successful login IP /16 + timestamp in Redis.
     A subsequent login from a different /16 within the configured TTL
     window is flagged and forces the OTP flow even on a device that's
     already trusted — covers the "trusted laptop, account being used by
     a friend across town simultaneously" case.

The watermark overlay (frontend) is the fourth, social, layer and lives
in WatermarkOverlay.tsx — psychological deterrent, not enforcement.
"""
from __future__ import annotations

import hashlib
import ipaddress
import json
import secrets
import datetime as dt

from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .models import LoginEvent, TrustedDevice, User


# ---------- Device fingerprint ----------

def hash_device_id(raw_device_id: str) -> str:
    """Salted SHA-256 of the client-supplied device UUID.

    The salt comes from settings — rotating it forces every device back
    through the OTP flow on next login (panic button if the device-id
    column is exfiltrated)."""
    return hashlib.sha256(
        (settings.DEVICE_FINGERPRINT_SALT + raw_device_id).encode()
    ).hexdigest()


def is_trusted_device(db: Session, user_id, device_hash: str) -> TrustedDevice | None:
    return db.scalar(
        select(TrustedDevice).where(
            TrustedDevice.user_id == user_id,
            TrustedDevice.device_hash == device_hash,
        )
    )


def trust_device(
    db: Session, *, user_id, device_hash: str, label: str | None, ip: str | None,
) -> TrustedDevice:
    existing = is_trusted_device(db, user_id, device_hash)
    if existing:
        existing.last_seen_at = dt.datetime.now(dt.timezone.utc)
        existing.last_ip = ip
        if label and not existing.label:
            existing.label = label
        return existing
    td = TrustedDevice(
        user_id=user_id, device_hash=device_hash,
        label=label, last_ip=ip,
    )
    db.add(td)
    return td


# ---------- Impossible-travel ----------

def _ip_bucket(ip: str | None) -> str | None:
    """Reduce an IP to a coarse-grained region key.

    /16 for IPv4, /48 for IPv6 — same ISP / metro area collapses to the
    same bucket so a router restart or NAT shuffle doesn't trip the
    detector, but a different country or ISP does."""
    if not ip:
        return None
    try:
        addr = ipaddress.ip_address(ip)
        if isinstance(addr, ipaddress.IPv4Address):
            return str(ipaddress.ip_network(f"{ip}/16", strict=False).network_address)
        return str(ipaddress.ip_network(f"{ip}/48", strict=False).network_address)
    except ValueError:
        return None


async def check_impossible_travel(redis: Redis, user_id, ip: str | None) -> str | None:
    """Return a string reason if this login looks like impossible travel.

    Stateless logic: compare the new IP-bucket against the last cached one
    for this user. If they differ we flag — the actual decision (force
    OTP, alert admin) is up to the caller. The cached bucket is refreshed
    by `record_successful_login`; we never refresh on flagged attempts so
    a flapping attacker can't hide their trail."""
    bucket = _ip_bucket(ip)
    if not bucket:
        return None
    raw = await redis.get(f"login:lastbucket:{user_id}")
    if not raw:
        return None
    last = raw.decode() if isinstance(raw, bytes) else raw
    if last != bucket:
        return f"ip-jump from {last} to {bucket}"
    return None


async def record_successful_login(redis: Redis, user_id, ip: str | None) -> None:
    bucket = _ip_bucket(ip)
    if not bucket:
        return
    await redis.set(
        f"login:lastbucket:{user_id}", bucket,
        ex=settings.IMPOSSIBLE_TRAVEL_TTL_SEC,
    )


# ---------- Email OTP challenge ----------

def generate_otp_code() -> str:
    """Six-digit numeric code. ~1M entropy combined with the 10-min TTL
    and per-account rate-limit (handled at the slowapi layer) is enough."""
    return f"{secrets.randbelow(1_000_000):06d}"


async def stash_otp_challenge(
    redis: Redis,
    *, user_id, device_hash: str, ip: str | None, ua: str | None, code: str,
) -> str:
    """Persist an OTP challenge in Redis and return the opaque token the
    frontend will submit alongside the code."""
    challenge_token = secrets.token_urlsafe(24)
    payload = {
        "user_id": str(user_id),
        "device_hash": device_hash,
        "ip": ip or "",
        "ua": ua or "",
        "code": code,
    }
    await redis.set(
        f"login:otp:{challenge_token}", json.dumps(payload),
        ex=settings.DEVICE_OTP_TTL_SEC,
    )
    return challenge_token


async def consume_otp_challenge(
    redis: Redis, *, challenge_token: str, code: str,
) -> dict | None:
    """Atomically verify-and-burn an OTP challenge. Returns the stored
    payload on success, None on bad/expired/burnt token."""
    key = f"login:otp:{challenge_token}"
    raw = await redis.get(key)
    if not raw:
        return None
    payload = json.loads(raw if isinstance(raw, str) else raw.decode())
    if payload.get("code") != code:
        return None
    await redis.delete(key)
    return payload


# ---------- Forensic log ----------

def log_login_event(
    db: Session,
    *, user: User | None, email: str, ip: str | None, ua: str | None,
    device_hash: str | None, status: str,
    suspicious: bool = False, suspicion_reason: str | None = None,
) -> LoginEvent:
    ev = LoginEvent(
        user_id=user.id if user else None,
        email_attempted=email,
        ip=ip, user_agent=ua, device_hash=device_hash,
        status=status,
        suspicious=suspicious,
        suspicion_reason=suspicion_reason,
    )
    db.add(ev)
    return ev
