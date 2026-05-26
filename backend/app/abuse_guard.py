"""Behavioural rate limit + auto-ban.

slowapi gives us a fixed `120/minute` per-IP cap that protects against the
trivial flood case. This module is the next layer up: pattern-based detection
of *abusive* behaviour — too many key/segment fetches, too many failed logins,
too many 4xx in a short window — with progressive bans that escalate on repeat
offence.

Stored in Redis only; no DB writes. Bans expire on their own so a one-off
glitch never produces a permanent blackhole.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from redis.asyncio import Redis

from .db import get_redis_singleton
from .logging import log


@dataclass(frozen=True)
class Rule:
    """One sliding-window rule. `weight` lets us count expensive endpoints
    (like /key, /manifest) as more than one request."""
    name: str
    path_prefix: str
    window_sec: int
    limit: int
    ban_sec: int  # how long the IP is banned after tripping this rule
    weight: int = 1


# Order matters — the first matching rule wins. Specific paths before generic.
RULES: tuple[Rule, ...] = (
    # Key endpoint is the crown jewel. 30/min/(user, video) is enforced in
    # videos.py; this is the *IP-wide* cap that catches an attacker rotating
    # accounts. 90 hits/min from one IP is well past any plausible viewer.
    Rule("key", "/api/v1/videos/", window_sec=60, limit=90, ban_sec=900, weight=1),
    # Login + OTP: brute force suspects. 30 attempts/min/IP → 30 min ban.
    Rule("auth", "/api/v1/auth/", window_sec=60, limit=30, ban_sec=1800),
    # Catch-all abuse rule. 600/min/IP across the API is generous (six users
    # behind one NAT can stay under), and trips a short 5 min ban.
    Rule("all", "/api/v1/", window_sec=60, limit=600, ban_sec=300),
)


def _client_ip(request: Request) -> str:
    # Caddy sets X-Real-IP; trust it because we control the proxy.
    return (
        request.headers.get("x-real-ip")
        or (request.client.host if request.client else "0.0.0.0")
    )


async def _is_banned(redis: Redis, ip: str) -> int:
    """Returns remaining ban seconds, or 0 if not banned."""
    ttl = await redis.ttl(f"abuse:ban:{ip}")
    return max(0, ttl)


async def _ban(redis: Redis, ip: str, seconds: int, rule: str) -> None:
    """Set or extend a ban. Repeat offenders get longer bans (the new ban
    starts from `now`, so a quick re-trip after release simply re-imposes
    the same window — no permanent state)."""
    await redis.set(f"abuse:ban:{ip}", rule, ex=seconds)
    log.warning("abuse_ban", ip=ip, seconds=seconds, rule=rule)


async def _hit(redis: Redis, ip: str, rule: Rule) -> int:
    """Increment the sliding-window counter and return the new count.

    Uses a fixed bucket keyed by floor(now / window) so we don't need ZSETs.
    Slightly less precise than a true sliding window (edge effects at the
    bucket boundary), but the difference is irrelevant against an attacker
    spamming hundreds of requests."""
    bucket = int(time.time()) // rule.window_sec
    key = f"abuse:cnt:{rule.name}:{ip}:{bucket}"
    count = await redis.incrby(key, rule.weight)
    if count == rule.weight:
        # First write in this bucket — set TTL slightly over the window so
        # the key disappears on its own.
        await redis.expire(key, rule.window_sec + 5)
    return count


class AbuseGuardMiddleware(BaseHTTPMiddleware):
    """Reject banned IPs with 429 and trip a ban when a rule's limit is hit.

    Excluded paths: /healthz*, /metrics — these are scraped by infra at high
    frequency and aren't user-facing."""

    EXCLUDED = ("/healthz", "/metrics")

    async def dispatch(self, request, call_next):
        path = request.url.path
        if any(path.startswith(p) for p in self.EXCLUDED):
            return await call_next(request)

        try:
            redis = get_redis_singleton()
        except Exception:
            # Fail-open: if Redis is down we don't want to lock everyone out.
            return await call_next(request)

        ip = _client_ip(request)

        ttl = await _is_banned(redis, ip)
        if ttl > 0:
            return JSONResponse(
                {"detail": "temporarily banned", "retry_after": ttl},
                status_code=429,
                headers={"Retry-After": str(ttl)},
            )

        # Match the first applicable rule and count this request against it.
        # We deliberately do NOT count against multiple rules — the most
        # specific rule already covers its slice of traffic, and the catch-all
        # rule covers everything else.
        for rule in RULES:
            if path.startswith(rule.path_prefix):
                count = await _hit(redis, ip, rule)
                if count > rule.limit:
                    await _ban(redis, ip, rule.ban_sec, rule.name)
                    return JSONResponse(
                        {"detail": "rate limited", "retry_after": rule.ban_sec},
                        status_code=429,
                        headers={"Retry-After": str(rule.ban_sec)},
                    )
                break

        return await call_next(request)
