"""Restore-drill: verify the cold backup is actually usable.

A backup you have never restored is not a backup. Run this quarterly
against a scratch namespace in S3 to prove the round-trip works.

What it checks:
  1. Latest db/<ts>.sql.gz exists in the backup bucket and is non-empty.
  2. The dump can be downloaded (initiates Restore if in Deep Archive,
     then waits up to --max-wait-min minutes for it to be retrievable).
  3. A sample of N media objects under media/ can be HEADed (or restored
     + HEADed). Default sample size is 5 — enough to detect a systemic
     problem without paying full-restore cost.
  4. Restored dump gunzips cleanly and contains expected table headers
     (users, courses, video_keys).

Run:
  docker compose exec api python -m scripts.restore_drill
  docker compose exec api python -m scripts.restore_drill --sample 20 --max-wait-min 60

Exit codes: 0 ok, 1 failure (use as a cron-checked health signal).
"""
from __future__ import annotations

import argparse
import gzip
import io
import random
import sys
import time

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.config import settings


EXPECTED_TABLES = (b"users", b"courses", b"video_keys")


def _aws():
    return boto3.client(
        "s3",
        region_name=settings.AWS_REGION,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        config=Config(retries={"max_attempts": 5, "mode": "adaptive"}),
    )


def _list(aws, prefix: str):
    out = []
    paginator = aws.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=settings.AWS_BACKUP_BUCKET, Prefix=prefix):
        out.extend(page.get("Contents", []) or [])
    return out


def _ensure_restored(aws, key: str, max_wait_min: int) -> None:
    """For Deep Archive / Glacier objects, request a restore and poll until ready."""
    head = aws.head_object(Bucket=settings.AWS_BACKUP_BUCKET, Key=key)
    storage = head.get("StorageClass", "STANDARD")
    if storage in ("STANDARD", "STANDARD_IA", "ONEZONE_IA", "INTELLIGENT_TIERING"):
        return

    restore = head.get("Restore", "")
    if "ongoing-request=\"false\"" in restore:
        return

    if "ongoing-request=\"true\"" not in restore:
        try:
            aws.restore_object(
                Bucket=settings.AWS_BACKUP_BUCKET, Key=key,
                RestoreRequest={"Days": 1, "GlacierJobParameters": {"Tier": "Standard"}},
            )
            print(f"  restore initiated for {key} ({storage})")
        except ClientError as e:
            if e.response["Error"]["Code"] != "RestoreAlreadyInProgress":
                raise

    deadline = time.time() + max_wait_min * 60
    while time.time() < deadline:
        h = aws.head_object(Bucket=settings.AWS_BACKUP_BUCKET, Key=key)
        if "ongoing-request=\"false\"" in (h.get("Restore") or ""):
            return
        time.sleep(60)
    raise TimeoutError(f"restore for {key} not ready after {max_wait_min}m")


def check_db_dump(aws, max_wait_min: int) -> None:
    objs = _list(aws, "db/")
    if not objs:
        raise RuntimeError("no db/*.sql.gz objects in backup bucket")
    latest = max(objs, key=lambda o: o["LastModified"])
    key = latest["Key"]
    print(f"latest db dump: {key} ({latest['Size']} bytes)")
    if latest["Size"] < 1024:
        raise RuntimeError(f"latest dump is implausibly small: {latest['Size']} bytes")

    _ensure_restored(aws, key, max_wait_min)
    body = aws.get_object(Bucket=settings.AWS_BACKUP_BUCKET, Key=key)["Body"].read()
    plain = gzip.decompress(body)

    missing = [t.decode() for t in EXPECTED_TABLES if t not in plain]
    if missing:
        raise RuntimeError(f"dump missing expected tables: {missing}")
    print(f"  dump OK ({len(plain)} bytes uncompressed, all expected tables present)")


def check_media_sample(aws, sample: int, max_wait_min: int) -> None:
    objs = _list(aws, "media/")
    if not objs:
        print("media/: nothing to sample (empty)")
        return
    chosen = random.sample(objs, min(sample, len(objs)))
    print(f"media/: sampling {len(chosen)} of {len(objs)} objects")
    for o in chosen:
        _ensure_restored(aws, o["Key"], max_wait_min)
        h = aws.head_object(Bucket=settings.AWS_BACKUP_BUCKET, Key=o["Key"])
        if h["ContentLength"] == 0:
            raise RuntimeError(f"{o['Key']} is zero bytes")
    print(f"  sample OK")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--sample", type=int, default=5)
    p.add_argument("--max-wait-min", type=int, default=0,
                   help="Wait up to N minutes for Glacier restores. 0 = skip cold objects.")
    args = p.parse_args()

    if not settings.AWS_BACKUP_BUCKET:
        print("AWS backup not configured", file=sys.stderr)
        return 1

    aws = _aws()
    try:
        check_db_dump(aws, args.max_wait_min)
        check_media_sample(aws, args.sample, args.max_wait_min)
        print("RESTORE DRILL OK")
        return 0
    except Exception as e:
        print(f"RESTORE DRILL FAILED: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
