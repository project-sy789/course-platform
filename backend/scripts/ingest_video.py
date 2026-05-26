"""Register an encrypted HLS asset in the database.

Encode and upload the HLS files (m3u8 + .ts segments) to R2 OUT-OF-BAND.
This script only:
  - Inserts a Course (if needed) by slug
  - Inserts a Video row (with R2 manifest key)
  - Inserts a Lesson under the course
  - Encrypts the AES-128 key with the master KEK and stores it in video_keys

Run inside the api container:

  docker compose exec api python -m scripts.ingest_video \
    --r2-key courses/intro/lessons/01/index.m3u8 \
    --aes-key-hex "$(cat video.key | xxd -p)" \
    --course-slug intro --course-title "Intro Course" \
    --lesson-title "Welcome" --position 1
"""
from __future__ import annotations

import argparse
import sys
from sqlalchemy import select

from app.db import SessionLocal
from app.models import Course, Video, Lesson, VideoKey
from app.crypto import encrypt_video_key


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--r2-key", required=True, help="R2 object key for the m3u8 manifest")
    p.add_argument("--aes-key-hex", required=True, help="32-char hex of the 16-byte AES-128 key")
    p.add_argument("--duration-sec", type=int, default=None)
    p.add_argument("--course-slug", required=True)
    p.add_argument("--course-title", default=None, help="Used only when creating a new course")
    p.add_argument("--course-description", default=None)
    p.add_argument("--course-price-cents", type=int, default=0)
    p.add_argument("--lesson-title", required=True)
    p.add_argument("--position", type=int, required=True)
    p.add_argument("--is-preview", action="store_true")
    args = p.parse_args()

    raw = bytes.fromhex(args.aes_key_hex)
    if len(raw) != 16:
        print("ERR: aes-key-hex must decode to exactly 16 bytes", file=sys.stderr)
        return 2

    db = SessionLocal()
    try:
        course = db.scalar(select(Course).where(Course.slug == args.course_slug))
        if not course:
            if not args.course_title:
                print("ERR: --course-title required when creating a new course", file=sys.stderr)
                return 2
            course = Course(
                slug=args.course_slug,
                title=args.course_title,
                description=args.course_description,
                price_cents=args.course_price_cents,
            )
            db.add(course)
            db.flush()

        video = Video(r2_manifest_key=args.r2_key, duration_sec=args.duration_sec)
        db.add(video)
        db.flush()

        lesson = Lesson(
            course_id=course.id,
            video_id=video.id,
            title=args.lesson_title,
            position=args.position,
            is_preview=args.is_preview,
        )
        db.add(lesson)

        ct, nonce, tag = encrypt_video_key(raw)
        db.add(VideoKey(
            video_id=video.id,
            key_ciphertext=ct,
            key_nonce=nonce,
            key_tag=tag,
        ))

        db.commit()

        print(f"course_id  = {course.id}")
        print(f"video_id   = {video.id}")
        print(f"lesson_id  = {lesson.id}")
        return 0
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
