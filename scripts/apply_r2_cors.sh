#!/usr/bin/env bash
# Apply a strict CORS policy to the Cloudflare R2 bucket so segment URLs
# can only be loaded by our own frontend origin(s).
#
# Why: R2 presigned URLs are valid for any caller that holds them. A leaked
# 10-second URL still works from another page if that page can fetch it.
# A bucket-level CORS policy means `https://attacker.example.com` cannot
# read segments via XHR/fetch even when handed a presigned URL — the browser
# refuses the response.
#
# This does NOT protect against:
#   * server-side scrapers (no Origin header → CORS doesn't apply)
#   * a `<video>` tag on attacker.com using <source src=...> (no preflight)
# For those, lean on the session-bound presign expiry (10s) and IP-bound
# session token. CORS is the layer that catches the browser-based attacker.
#
# Usage:
#   ALLOWED_ORIGINS="https://app.example.com,https://www.example.com" \
#     ./scripts/apply_r2_cors.sh
#
# Requires: aws CLI configured against the R2 endpoint, OR set
# R2_* env vars and the script will configure boto3 inline.
set -euo pipefail

: "${ALLOWED_ORIGINS:?Set ALLOWED_ORIGINS=comma-separated list}"
: "${R2_ACCOUNT_ID:?Set R2_ACCOUNT_ID}"
: "${R2_BUCKET:?Set R2_BUCKET}"
: "${R2_ACCESS_KEY_ID:?Set R2_ACCESS_KEY_ID}"
: "${R2_SECRET_ACCESS_KEY:?Set R2_SECRET_ACCESS_KEY}"

python3 - <<PY
import json, os, sys
import boto3
from botocore.config import Config

origins = [o.strip() for o in os.environ["ALLOWED_ORIGINS"].split(",") if o.strip()]
client = boto3.client(
    "s3",
    endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
    aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
    aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
    region_name="auto",
    config=Config(signature_version="s3v4"),
)

# GET only — segments and key blobs are never written by the browser, and
# allowing PUT/DELETE would let a CORS-aware attacker tamper if creds leak.
# Range header is whitelisted because hls.js sends one for byte-range fragments.
policy = {
    "CORSRules": [
        {
            "AllowedOrigins": origins,
            "AllowedMethods": ["GET", "HEAD"],
            "AllowedHeaders": ["Range", "If-Match", "If-None-Match"],
            "ExposeHeaders": ["Content-Length", "Content-Range", "ETag"],
            "MaxAgeSeconds": 3600,
        }
    ]
}

client.put_bucket_cors(
    Bucket=os.environ["R2_BUCKET"],
    CORSConfiguration=policy,
)
print("Applied CORS policy:", json.dumps(policy, indent=2))

# Read it back so we can be sure CF accepted it (R2 occasionally lags).
got = client.get_bucket_cors(Bucket=os.environ["R2_BUCKET"])
print("Bucket now reports:", json.dumps(got["CORSRules"], indent=2))
PY
