"""Cloudflare R2 client (S3-compatible).

Used only by admin upload endpoints. Regular playback never touches this —
the player fetches segments directly from R2_PUBLIC_BASE.
"""
from __future__ import annotations

import boto3
from botocore.config import Config
from .config import settings


def get_r2_client():
    if not all([
        settings.R2_ACCOUNT_ID,
        settings.R2_BUCKET,
        settings.R2_ACCESS_KEY_ID,
        settings.R2_SECRET_ACCESS_KEY,
    ]):
        raise RuntimeError("R2 credentials not configured")
    return boto3.client(
        "s3",
        endpoint_url=f"https://{settings.R2_ACCOUNT_ID}.r2.cloudflarestorage.com",
        aws_access_key_id=settings.R2_ACCESS_KEY_ID,
        aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
        region_name="auto",
        config=Config(signature_version="s3v4", retries={"max_attempts": 3}),
    )


def upload_bytes(key: str, data: bytes, content_type: str) -> None:
    client = get_r2_client()
    client.put_object(
        Bucket=settings.R2_BUCKET,
        Key=key,
        Body=data,
        ContentType=content_type,
        CacheControl="public, max-age=31536000, immutable",
    )
