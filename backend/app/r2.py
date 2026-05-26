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


def get_bytes(key: str) -> bytes:
    """Fetch an object from R2. Used for materials served through the watermark
    pipeline (we never want to give the user a public R2 URL for those)."""
    client = get_r2_client()
    obj = client.get_object(Bucket=settings.R2_BUCKET, Key=key)
    return obj["Body"].read()


def delete_object(key: str) -> None:
    client = get_r2_client()
    client.delete_object(Bucket=settings.R2_BUCKET, Key=key)


def presigned_get_url(key: str, expires_in: int = 10) -> str:
    """Short-lived presigned GET URL for a private R2 object.

    Used by the playback proxy to hand out per-segment URLs that expire in
    seconds. The bucket itself can — and should — be set to private:
    `R2_PUBLIC_BASE` becomes redundant for video delivery; only used by
    legacy public material URLs that haven't been migrated yet."""
    client = get_r2_client()
    return client.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.R2_BUCKET, "Key": key},
        ExpiresIn=expires_in,
    )
