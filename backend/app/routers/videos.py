import hashlib
import json
import secrets
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session
from redis.asyncio import Redis

from ..db import get_session, get_redis
from ..deps import current_user, require_enrollment_for_video
from ..models import User, Video, VideoKey, KeyAccessLog
from ..crypto import decrypt_video_key
from ..config import settings

router = APIRouter(prefix="/api/v1/videos", tags=["videos"])


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
    token = secrets.token_urlsafe(32)
    payload = json.dumps({
        "uid": str(user.id),
        "vid": str(video.id),
        "ip": ip,
        "ua": ua_hash,
    })
    await redis.set(f"pbsess:{token}", payload, ex=settings.PB_SESSION_TTL_SEC)

    manifest_url = f"{settings.R2_PUBLIC_BASE}/{video.r2_manifest_key}"
    return {
        "manifest_url": manifest_url,
        "key_url_template": f"/api/v1/videos/{video.id}/key?s={token}",
        "expires_in": settings.PB_SESSION_TTL_SEC,
    }


@router.get("/{video_id}/key")
async def get_video_key(
    video_id: str,
    s: str,
    request: Request,
    db: Session = Depends(get_session),
    redis: Redis = Depends(get_redis),
):
    """Deliver the raw 16-byte AES-128 key. Called by the HLS player."""
    ip, ua_hash = _client_ctx(request)

    def _log(user_id: str | None, granted: bool, reason: str):
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
