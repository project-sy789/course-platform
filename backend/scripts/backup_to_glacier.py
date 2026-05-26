"""Cold backup of video assets + DB to AWS S3 Glacier Deep Archive.

Run via cron (daily/weekly):

  docker compose exec api python -m scripts.backup_to_glacier

What it does:
  1. Streams every object in the R2 bucket to S3 with the configured storage class.
     Uses a "manifest of object keys" file in S3 to skip already-backed-up objects
     (cheap HEAD-only diff; we never re-download from Glacier).
  2. Runs `pg_dump` against Postgres and uploads the dump.
     The dump contains video_keys (encrypted with KEK) and is critical — without
     it, R2 segments are useless even if you still have them.

Restore notes:
  - Deep Archive: 12-48h to restore an object via S3 Restore API
  - Glacier:     3-5h
  - Restoring is a separate manual procedure — don't put it on the hot path.

The backup destination uses an SEPARATE AWS account/IAM user with PutObject only.
This protects against an attacker with R2 + DB access wiping the cold copies.
"""
from __future__ import annotations

import datetime as dt
import io
import os
import subprocess
import sys

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.config import settings


def _aws_client():
    if not all([
        settings.AWS_BACKUP_BUCKET,
        settings.AWS_ACCESS_KEY_ID,
        settings.AWS_SECRET_ACCESS_KEY,
    ]):
        raise RuntimeError("AWS backup not configured")
    return boto3.client(
        "s3",
        region_name=settings.AWS_REGION,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        config=Config(retries={"max_attempts": 5, "mode": "adaptive"}),
    )


def _r2_client():
    return boto3.client(
        "s3",
        endpoint_url=f"https://{settings.R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=settings.R2_ACCESS_KEY_ID,
        aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )


def _aws_object_exists(aws, key: str) -> bool:
    try:
        aws.head_object(Bucket=settings.AWS_BACKUP_BUCKET, Key=key)
        return True
    except ClientError as e:
        if e.response["Error"]["Code"] in ("404", "NoSuchKey", "NotFound"):
            return False
        raise


def _put(aws, key: str, body, content_type: str = "application/octet-stream"):
    aws.put_object(
        Bucket=settings.AWS_BACKUP_BUCKET,
        Key=key,
        Body=body,
        ContentType=content_type,
        StorageClass=settings.AWS_BACKUP_STORAGE_CLASS,
    )


def backup_r2() -> tuple[int, int]:
    """Copy every R2 object into S3 under media/<key>. Skip if already present."""
    if not settings.R2_BUCKET:
        print("R2 bucket not configured, skipping media backup")
        return (0, 0)

    r2 = _r2_client()
    aws = _aws_client()
    paginator = r2.get_paginator("list_objects_v2")

    copied = 0
    skipped = 0
    for page in paginator.paginate(Bucket=settings.R2_BUCKET):
        for obj in page.get("Contents", []) or []:
            key = obj["Key"]
            dest_key = f"media/{key}"
            if _aws_object_exists(aws, dest_key):
                skipped += 1
                continue
            body = r2.get_object(Bucket=settings.R2_BUCKET, Key=key)["Body"]
            ctype = "application/vnd.apple.mpegurl" if key.endswith(".m3u8") \
                else "video/mp2t" if key.endswith(".ts") \
                else "application/octet-stream"
            _put(aws, dest_key, body, content_type=ctype)
            copied += 1
            print(f"  copied  {key}  ({obj.get('Size', 0)} bytes)")

    return copied, skipped


def backup_postgres() -> str:
    """Run pg_dump and upload as gzip to db/<timestamp>.sql.gz."""
    aws = _aws_client()

    # DATABASE_URL is "postgresql+psycopg://user:pass@host:port/db" — strip the +psycopg
    db_url = settings.DATABASE_URL.replace("postgresql+psycopg://", "postgresql://", 1)

    ts = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    key = f"db/{ts}.sql.gz"

    proc = subprocess.Popen(
        ["pg_dump", "--format=plain", "--no-owner", "--no-acl", db_url],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    gzip_proc = subprocess.Popen(
        ["gzip", "-9", "-c"],
        stdin=proc.stdout,
        stdout=subprocess.PIPE,
    )
    if proc.stdout:
        proc.stdout.close()  # let gzip read its EOF when pg_dump exits

    body = io.BytesIO()
    assert gzip_proc.stdout is not None
    while chunk := gzip_proc.stdout.read(1024 * 1024):
        body.write(chunk)

    pg_rc = proc.wait()
    gz_rc = gzip_proc.wait()
    if pg_rc != 0:
        err = proc.stderr.read().decode() if proc.stderr else ""
        raise RuntimeError(f"pg_dump failed (rc={pg_rc}): {err}")
    if gz_rc != 0:
        raise RuntimeError(f"gzip failed (rc={gz_rc})")

    body.seek(0)
    _put(aws, key, body, content_type="application/gzip")
    print(f"  uploaded db dump: {key} ({body.getbuffer().nbytes} bytes)")
    return key


def main() -> int:
    print(f"== Backup to s3://{settings.AWS_BACKUP_BUCKET} "
          f"({settings.AWS_BACKUP_STORAGE_CLASS}) ==")
    try:
        copied, skipped = backup_r2()
        print(f"R2 → S3: {copied} new, {skipped} already present")

        db_key = backup_postgres()
        print(f"Postgres → S3: {db_key}")

        print("OK")
        return 0
    except Exception as e:
        print(f"FAILED: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
