import hashlib
import json
import re
import secrets
from urllib.parse import urlsplit
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session
from redis.asyncio import Redis

from ..db import get_session, get_redis
from ..deps import current_user, require_enrollment_for_video
from ..logging import log
from ..models import User, Video, VideoKey, KeyAccessLog
from ..crypto import decrypt_video_key
from ..r2 import get_bytes, presigned_get_url
from ..config import settings

router = APIRouter(prefix="/api/v1/videos", tags=["videos"])


# Single-use, 10-second token TTLs. The session token (PB_SESSION_TTL_SEC)
# is the long-lived envelope; key + segment + manifest tokens are minted from
# the session and burn themselves on first redemption. Anyone who scrapes a
# URL has a ~10-second window to use it from the same IP+UA, after which it
# cannot be replayed even with the bearer cookie.
_SHORT_TOKEN_TTL = 10


def _client_ctx(request: Request) -> tuple[str, str]:
    """Return (ip, ua_hash). Trusts X-Real-IP only because Caddy sets it."""
    ip = request.headers.get("x-real-ip") or (request.client.host if request.client else "0.0.0.0")
    ua = request.headers.get("user-agent", "")
    ua_hash = hashlib.sha256(ua.encode()).hexdigest()[:16]
    return ip, ua_hash


@router.post("/{video_id}/playback-session")
async def create_playback_session(
    video_id: str,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
    redis: Redis = Depends(get_redis),
):
    """Mint a short-lived playback session token bound to user+video+ip+ua."""
    lesson = require_enrollment_for_video(video_id, user, db)
    video = db.get(Video, lesson.video_id)
    if not video:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "video not found")

    ip, ua_hash = _client_ctx(request)

    # Concurrent session cap: prevents one account from streaming on N devices at once.
    sess_set_key = f"pbsess:user:{user.id}"
    active = await redis.scard(sess_set_key)
    if active >= settings.MAX_CONCURRENT_SESSIONS:
        # Drop expired members opportunistically: re-check each token's existence.
        members = await redis.smembers(sess_set_key)
        for m in members:
            if not await redis.exists(f"pbsess:{m}"):
                await redis.srem(sess_set_key, m)
        active = await redis.scard(sess_set_key)
        if active >= settings.MAX_CONCURRENT_SESSIONS:
            log.warning("session_cap_hit", user_id=str(user.id), active=active)
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "too many active sessions")

    token = secrets.token_urlsafe(32)
    payload = json.dumps({
        "uid": str(user.id),
        "vid": str(video.id),
        "ip": ip,
        "ua": ua_hash,
    })
    await redis.set(f"pbsess:{token}", payload, ex=settings.PB_SESSION_TTL_SEC)
    await redis.sadd(sess_set_key, token)
    await redis.expire(sess_set_key, settings.PB_SESSION_TTL_SEC * 2)

    # The manifest is no longer fetched directly from R2 by the player —
    # the bucket is private. We proxy it through this API so we can rewrite
    # every segment URL to a presigned URL that expires in seconds, and so
    # the key URI line is force-rewritten to a single-use endpoint here.
    return {
        "manifest_url": f"/api/v1/videos/{video.id}/manifest?s={token}",
        "key_url_template": f"/api/v1/videos/{video.id}/key?s={token}",
        "expires_in": settings.PB_SESSION_TTL_SEC,
    }


async def _mint_short_token(redis: Redis, *, session_token: str, kind: str,
                             extra: dict | None = None) -> str:
    """Mint a 10-second, single-use bearer token bound to the playback session.

    `kind` namespaces the token (key|seg|manifest) so a token issued for one
    purpose can't be redeemed for another. `extra` carries per-token state
    (e.g. the segment key for a "seg" token) and is dropped along with the
    token on redeem."""
    nonce = secrets.token_urlsafe(16)
    payload = {"sess": session_token, "kind": kind, **(extra or {})}
    await redis.set(f"pbnonce:{kind}:{nonce}", json.dumps(payload), ex=_SHORT_TOKEN_TTL)
    return nonce


async def _consume_short_token(redis: Redis, *, kind: str, nonce: str) -> dict | None:
    """Atomically verify-and-burn. Returns the stored payload on success."""
    key = f"pbnonce:{kind}:{nonce}"
    raw = await redis.get(key)
    if not raw:
        return None
    await redis.delete(key)
    return json.loads(raw if isinstance(raw, str) else raw.decode())


@router.get("/{video_id}/manifest")
async def proxied_manifest(
    video_id: str,
    s: str,
    request: Request,
    db: Session = Depends(get_session),
    redis: Redis = Depends(get_redis),
):
    """Fetch the HLS manifest from private R2 and rewrite every URL inside it.

    Three rewrites happen here:
      * #EXT-X-KEY URI=...  → /api/v1/videos/{id}/key?s={token}&n={one-shot}
      * Each segment line   → presigned R2 URL (10-second TTL)
      * Variant manifests   → recursive call back to /manifest?... so each
                              variant gets the same private treatment

    The session cookie + IP/UA bind already happened in
    create_playback_session; here we only validate the session token's
    binding then rebind on each segment via the per-segment short token."""
    ip, ua_hash = _client_ctx(request)
    raw = await redis.get(f"pbsess:{s}")
    if not raw:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "session expired")
    sess = json.loads(raw)
    if sess["vid"] != video_id or sess["ip"] != ip or sess["ua"] != ua_hash:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "context mismatch")

    video = db.get(Video, video_id)
    if not video:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "video not found")

    text = get_bytes(video.r2_manifest_key).decode("utf-8")
    base_dir = video.r2_manifest_key.rsplit("/", 1)[0]

    # Force-overwrite the key directive so the manifest a thief might exfil
    # can't reuse a stale URI. We mint a fresh single-use key token now;
    # hls.js will burn it on its first GET — any retry forces a new manifest.
    key_nonce = await _mint_short_token(redis, session_token=s, kind="key")
    key_uri = f"/api/v1/videos/{video_id}/key?s={s}&n={key_nonce}"

    out_lines: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("#EXT-X-KEY"):
            # Replace with our key URI verbatim, preserving the METHOD/IV.
            iv_match = re.search(r'IV=0x[0-9A-Fa-f]+', stripped)
            iv_part = f',{iv_match.group(0)}' if iv_match else ""
            out_lines.append(f'#EXT-X-KEY:METHOD=AES-128,URI="{key_uri}"{iv_part}')
            continue
        if stripped and not stripped.startswith("#"):
            # Segment or sub-manifest reference. Resolve to absolute R2 key
            # and either presign (segment) or recurse (variant manifest).
            r2_key = stripped if "/" in stripped and stripped.startswith(base_dir) \
                else f"{base_dir}/{stripped}"
            if stripped.endswith(".m3u8"):
                # Variant manifest — keep it private by re-routing back here.
                # We pass a fresh session-bound short token; the inner call
                # will mint its own key/segment tokens.
                sub_nonce = await _mint_short_token(
                    redis, session_token=s, kind="manifest",
                    extra={"key": r2_key},
                )
                out_lines.append(
                    f"/api/v1/videos/{video_id}/sub-manifest?s={s}&n={sub_nonce}"
                )
            else:
                out_lines.append(presigned_get_url(r2_key, expires_in=_SHORT_TOKEN_TTL))
            continue
        out_lines.append(line)

    body = "\n".join(out_lines) + "\n"
    return Response(
        content=body,
        media_type="application/vnd.apple.mpegurl",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, private",
            "X-Content-Type-Options": "nosniff",
            # Read + stripped by the Cloudflare edge worker to mint a
            # short-lived HMAC-signed media cookie. Never reaches the browser.
            "X-Cp-Uid": str(sess["uid"]),
        },
    )


@router.get("/{video_id}/sub-manifest")
async def proxied_sub_manifest(
    video_id: str,
    s: str,
    n: str,
    request: Request,
    db: Session = Depends(get_session),
    redis: Redis = Depends(get_redis),
):
    """Variant playlist (per-bitrate). Same rewrites as the master."""
    ip, ua_hash = _client_ctx(request)
    raw_sess = await redis.get(f"pbsess:{s}")
    if not raw_sess:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "session expired")
    sess = json.loads(raw_sess)
    if sess["vid"] != video_id or sess["ip"] != ip or sess["ua"] != ua_hash:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "context mismatch")

    payload = await _consume_short_token(redis, kind="manifest", nonce=n)
    if not payload or payload.get("sess") != s:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "manifest token expired")

    sub_key = payload["key"]
    text = get_bytes(sub_key).decode("utf-8")
    base_dir = sub_key.rsplit("/", 1)[0]

    key_nonce = await _mint_short_token(redis, session_token=s, kind="key")
    key_uri = f"/api/v1/videos/{video_id}/key?s={s}&n={key_nonce}"

    out_lines: list[str] = []
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("#EXT-X-KEY"):
            iv_match = re.search(r'IV=0x[0-9A-Fa-f]+', stripped)
            iv_part = f',{iv_match.group(0)}' if iv_match else ""
            out_lines.append(f'#EXT-X-KEY:METHOD=AES-128,URI="{key_uri}"{iv_part}')
            continue
        if stripped and not stripped.startswith("#"):
            r2_key = f"{base_dir}/{stripped}"
            out_lines.append(presigned_get_url(r2_key, expires_in=_SHORT_TOKEN_TTL))
            continue
        out_lines.append(line)

    return Response(
        content="\n".join(out_lines) + "\n",
        media_type="application/vnd.apple.mpegurl",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, private",
            "X-Content-Type-Options": "nosniff",
            "X-Cp-Uid": str(sess["uid"]),
        },
    )


@router.get("/{video_id}/key")
async def get_video_key(
    video_id: str,
    s: str,
    request: Request,
    n: str | None = None,
    db: Session = Depends(get_session),
    redis: Redis = Depends(get_redis),
):
    """Deliver the raw 16-byte AES-128 key. Called by the HLS player.

    The key URI in the manifest carries `n` — a single-use 10-second nonce
    that we burn on first redemption. Without `n` (legacy clients) the
    request still works as long as the session token is valid + bound, but
    the new manifest proxy always emits `n`, so any URL captured from the
    wire after the player's own request will already be dead."""
    ip, ua_hash = _client_ctx(request)

    def _log(user_id: str | None, granted: bool, reason: str):
        # Structured log line — picked up by Loki for alerting / forensics.
        log.info(
            "key_access",
            granted=granted,
            reason=reason,
            video_id=str(video_id),
            target_user_id=user_id,
        )
        try:
            db.add(KeyAccessLog(
                user_id=user_id,
                video_id=video_id,
                ip=ip,
                user_agent=request.headers.get("user-agent", "")[:512],
                granted=granted,
                reason=reason,
            ))
            db.commit()
        except Exception:
            db.rollback()

    raw = await redis.get(f"pbsess:{s}")
    if not raw:
        _log(None, False, "no_session")
        raise HTTPException(status.HTTP_403_FORBIDDEN, "session expired")

    sess = json.loads(raw)
    if sess["vid"] != video_id or sess["ip"] != ip or sess["ua"] != ua_hash:
        _log(sess.get("uid"), False, "context_mismatch")
        raise HTTPException(status.HTTP_403_FORBIDDEN, "context mismatch")

    # Single-use nonce: present iff the manifest came through the proxy.
    # Burning it here means a captured key URL is dead after one fetch.
    if n is not None:
        token_payload = await _consume_short_token(redis, kind="key", nonce=n)
        if not token_payload or token_payload.get("sess") != s:
            _log(sess.get("uid"), False, "nonce_invalid")
            raise HTTPException(status.HTTP_403_FORBIDDEN, "key token expired")

    # Per-(user, video) rate limit. Catches scripted scrapers hammering the key endpoint.
    rl_key = f"keyrl:{sess['uid']}:{video_id}"
    count = await redis.incr(rl_key)
    if count == 1:
        await redis.expire(rl_key, 60)
    if count > settings.KEY_RATE_LIMIT_PER_MIN:
        _log(sess["uid"], False, "rate_limited")
        log.warning("key_rate_limited", user_id=sess["uid"], video_id=str(video_id), count=count)
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "too many requests")

    user = db.get(User, sess["uid"])
    if not user or not user.is_active:
        _log(sess["uid"], False, "user_inactive")
        raise HTTPException(status.HTTP_403_FORBIDDEN, "forbidden")

    vk = db.get(VideoKey, video_id)
    if not vk:
        _log(sess["uid"], False, "no_key")
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no key")

    plaintext = decrypt_video_key(vk.key_ciphertext, vk.key_nonce, vk.key_tag)
    _log(sess["uid"], True, "ok")

    return Response(
        content=plaintext,
        media_type="application/octet-stream",
        headers={
            "Cache-Control": "no-store, no-cache, must-revalidate, private",
            "Pragma": "no-cache",
            "X-Content-Type-Options": "nosniff",
        },
    )
