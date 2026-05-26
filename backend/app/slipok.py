"""SlipOK API client — automated Thai bank-transfer slip verification.

SlipOK reads the QR / OCR on a Thai bank slip image and returns the parsed
transaction (amount, receiver account, slip ref, timestamp). We pass the
slip the user uploaded; if the response matches what we expect (correct
receiver, amount >= expected) we auto-approve, else fall through to admin.

API contract (as of 2026-05):
  POST https://api.slipok.com/api/line/apikey/{branch_id}
  Headers: x-authorization: <api_key>
  Multipart body: files=<image>
  Response 200: { "success": true, "data": { ...slip... } }
  Response 4xx: { "success": false, "code": <int>, "message": "..." }

We deliberately don't model the entire response — we only need a few fields
and want to survive minor schema additions.
"""
from __future__ import annotations

import json
from dataclasses import dataclass

import httpx

from .config import settings
from .logging import log


SLIPOK_BASE = "https://api.slipok.com/api/line/apikey"


@dataclass(frozen=True)
class SlipVerifyResult:
    ok: bool
    auto_approve: bool
    raw: dict
    slip_ref: str | None
    amount_satang: int | None
    receiver_account: str | None
    reason: str  # human-readable, ends up in admin UI + ledger


def configured() -> bool:
    return bool(settings.SLIPOK_API_KEY and settings.SLIPOK_BRANCH_ID)


async def verify_slip(image_bytes: bytes, filename: str,
                      expected_amount_satang: int) -> SlipVerifyResult:
    """POST the image to SlipOK and decide whether to auto-approve.

    Auto-approval requires ALL of:
      - HTTP success + success=true
      - receiver account matches RECEIVER_BANK_ACCOUNT (suffix match — Thai
        banks mask middle digits in their slip output)
      - amount on the slip >= expected_amount - tolerance

    Anything else returns ok=True (no error) but auto_approve=False so the
    upload row stays 'pending' for admin review."""
    if not configured():
        return SlipVerifyResult(
            ok=True, auto_approve=False, raw={}, slip_ref=None,
            amount_satang=None, receiver_account=None,
            reason="slipok_disabled",
        )

    url = f"{SLIPOK_BASE}/{settings.SLIPOK_BRANCH_ID}"
    headers = {"x-authorization": settings.SLIPOK_API_KEY}
    try:
        async with httpx.AsyncClient(timeout=15.0) as cx:
            r = await cx.post(
                url, headers=headers,
                files={"files": (filename, image_bytes, "image/jpeg")},
            )
        raw = r.json() if r.headers.get("content-type", "").startswith("application/json") else {"text": r.text}
    except (httpx.HTTPError, json.JSONDecodeError) as e:
        log.warning("slipok_http_error", error=str(e))
        return SlipVerifyResult(
            ok=False, auto_approve=False, raw={}, slip_ref=None,
            amount_satang=None, receiver_account=None,
            reason=f"slipok_unreachable:{type(e).__name__}",
        )

    if r.status_code >= 400 or not raw.get("success"):
        # Common reasons: duplicate slip, unreadable image, expired slip,
        # SlipOK rate limit. These are all "needs admin" not "outright fail".
        log.info("slipok_rejected", status=r.status_code, body=raw)
        return SlipVerifyResult(
            ok=True, auto_approve=False, raw=raw, slip_ref=None,
            amount_satang=None, receiver_account=None,
            reason=f"slipok_no_match:{raw.get('code') or r.status_code}",
        )

    data = raw.get("data") or {}
    # SlipOK fields are documented in baht — we store satang internally.
    try:
        amount_satang = int(round(float(data.get("amount", 0)) * 100))
    except (TypeError, ValueError):
        amount_satang = None
    slip_ref = data.get("transRef") or data.get("ref") or None
    receiver = (data.get("receiver") or {})
    recv_account = (receiver.get("account") or {}).get("value") or receiver.get("displayName") or None

    tol = settings.SLIPOK_AMOUNT_TOLERANCE_SATANG
    expected_account = settings.RECEIVER_BANK_ACCOUNT.replace("-", "").replace(" ", "")
    got_account = (recv_account or "").replace("-", "").replace(" ", "").replace("x", "").replace("X", "")

    amount_ok = amount_satang is not None and amount_satang >= expected_amount_satang - tol
    # Banks mask middle digits like "xxx-x-x1234-x" — match on the trailing
    # 4-6 digits, which is what's actually visible in their slips.
    tail_match = bool(expected_account) and bool(got_account) and \
        expected_account[-4:] == got_account[-4:]

    auto = amount_ok and tail_match
    reason = "auto_ok" if auto else (
        "amount_mismatch" if not amount_ok else "account_mismatch"
    )

    return SlipVerifyResult(
        ok=True, auto_approve=auto, raw=raw,
        slip_ref=slip_ref, amount_satang=amount_satang,
        receiver_account=recv_account, reason=reason,
    )
