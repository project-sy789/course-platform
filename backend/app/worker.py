"""Arq worker for background video encoding.

Why background:
  - ffmpeg of a 1080p ladder takes minutes; we don't want the admin upload HTTP
    request to hold open that long.
  - The web container should not compete for CPU with ffmpeg.

Flow:
  1. Admin uploads ONE raw source file (no pre-encoded ladder) via
     /api/v1/admin/encode-jobs (see routers/admin.py).
  2. Admin endpoint inserts an EncodeJob row (status=pending), enqueues
     `encode_video` on this worker, and returns 202 with the job id.
  3. Worker runs scripts/encode_multibitrate.sh against the buffered source,
     uploads the resulting ladder to R2, creates Course/Video/Lesson/VideoKey
     rows, then flips the job to status=done. Failures land in status=failed
     with the captured stderr in `error`.

Run:
  docker compose run --rm worker arq app.worker.WorkerSettings
  (or as a long-running service — see docker-compose.yml)
"""
from __future__ import annotations

import asyncio
import datetime as dt
import os
import shutil
import subprocess
import tempfile
import uuid

from arq.connections import RedisSettings
from sqlalchemy import select

from .config import settings
from .crypto import encrypt_video_key
from .db import SessionLocal
from .logging import configure_logging, log
from .models import Course, EncodeJob, Lesson, Video, VideoKey
from .r2 import upload_bytes


_BUFFER_ROOT = "/tmp/course-uploads"
_ENCODE_SCRIPT = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "scripts", "encode_multibitrate.sh",
)


def _r2_content_type(rel: str) -> str:
    if rel.endswith(".m3u8"):
        return "application/vnd.apple.mpegurl"
    if rel.endswith(".ts"):
        return "video/mp2t"
    return "application/octet-stream"


def _set_status(session, job_id: uuid.UUID, status: str, **fields):
    job = session.get(EncodeJob, job_id)
    job.status = status
    for k, v in fields.items():
        setattr(job, k, v)
    job.updated_at = dt.datetime.now(dt.timezone.utc)
    session.commit()


def _do_encode(job_id: uuid.UUID) -> None:
    """Synchronous core — runs ffmpeg in a thread so arq's event loop stays free."""
    session = SessionLocal()
    try:
        job = session.get(EncodeJob, job_id)
        if not job:
            log.error("encode_job_missing", job_id=str(job_id))
            return
        if job.status != "pending":
            log.info("encode_job_skipped", job_id=str(job_id), status=job.status)
            return

        _set_status(session, job_id, "running")
        log.info("encode_started", job_id=str(job_id), upload_id=job.upload_id)

        upload_dir = os.path.join(_BUFFER_ROOT, job.upload_id)
        sources = [f for f in os.listdir(upload_dir) if not f.startswith(".")]
        if not sources:
            raise RuntimeError("no source file in upload buffer")
        if len(sources) > 1:
            raise RuntimeError(f"expected exactly one source file, got {len(sources)}")
        src_path = os.path.join(upload_dir, sources[0])

        out_dir = tempfile.mkdtemp(prefix="encode-", dir=_BUFFER_ROOT)
        try:
            proc = subprocess.run(
                [_ENCODE_SCRIPT, src_path, out_dir, settings.R2_PUBLIC_BASE],
                capture_output=True, text=True, timeout=60 * 60 * 4,
            )
            if proc.returncode != 0:
                raise RuntimeError(f"ffmpeg failed: {proc.stderr[-2000:]}")

            with open(os.path.join(out_dir, "key.hex")) as f:
                raw_key = bytes.fromhex(f.read().strip())
            if len(raw_key) != 16:
                raise RuntimeError("key.hex did not decode to 16 bytes")
            os.remove(os.path.join(out_dir, "key.hex"))

            course = session.scalar(select(Course).where(Course.slug == job.course_slug))
            if not course:
                raise RuntimeError(f"course '{job.course_slug}' not found")

            video_id = uuid.uuid4()
            r2_prefix = f"courses/{job.course_slug}/lessons/{video_id}"
            manifest_key = f"{r2_prefix}/master.m3u8"

            rel_files: list[str] = []
            for root, _d, fnames in os.walk(out_dir):
                for fname in fnames:
                    full = os.path.join(root, fname)
                    rel = os.path.relpath(full, out_dir).replace(os.sep, "/")
                    rel_files.append(rel)
            rel_files.sort()

            for rel in rel_files:
                with open(os.path.join(out_dir, rel), "rb") as f:
                    upload_bytes(f"{r2_prefix}/{rel}", f.read(), _r2_content_type(rel))

            video = Video(id=video_id, r2_manifest_key=manifest_key)
            session.add(video); session.flush()
            session.add(Lesson(
                course_id=course.id, video_id=video.id,
                title=job.lesson_title, position=job.position, is_preview=job.is_preview,
            ))
            ct, nonce, tag = encrypt_video_key(raw_key)
            session.add(VideoKey(
                video_id=video.id, key_ciphertext=ct, key_nonce=nonce, key_tag=tag,
            ))
            session.commit()
        finally:
            shutil.rmtree(out_dir, ignore_errors=True)
            shutil.rmtree(upload_dir, ignore_errors=True)

        _set_status(session, job_id, "done", video_id=video_id)
        log.info("encode_done", job_id=str(job_id), video_id=str(video_id))
    except Exception as e:
        log.exception("encode_failed", job_id=str(job_id))
        try:
            _set_status(session, job_id, "failed", error=str(e)[:2000])
        except Exception:
            session.rollback()
    finally:
        session.close()


async def encode_video(ctx, job_id: str) -> None:
    """Arq task entrypoint. Offload the blocking encode to a thread."""
    await asyncio.to_thread(_do_encode, uuid.UUID(job_id))


async def startup(ctx):
    configure_logging()
    log.info("worker_started")


async def shutdown(ctx):
    log.info("worker_stopped")


class WorkerSettings:
    functions = [encode_video]
    redis_settings = RedisSettings.from_dsn(settings.REDIS_URL)
    on_startup = startup
    on_shutdown = shutdown
    max_jobs = 1               # one ffmpeg at a time per worker container
    job_timeout = 60 * 60 * 4  # 4 hours hard cap
    keep_result = 60 * 60 * 24
