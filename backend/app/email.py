"""Email sender — provider-agnostic dispatcher.

Reads runtime config from `app_settings` (DB) on every send so admins can
flip provider / rotate API keys without restarting the API. Five transports:

  - smtp     classic SMTP, used by the in-stack Postfix container or any
             external relay; credentials come from env (SMTP_HOST/USER/PASS)
  - resend   Resend REST API; api_key is a `re_…` secret
  - postmark Postmark REST API; api_key is the Server Token
  - sendgrid SendGrid v3 REST API; api_key is an `SG.…` token
  - disabled no-op; logs `email_disabled_skipped`. Default for dev/test.

If a provider is selected but unconfigured (eg api_key empty), we log
`email_provider_misconfigured` and return — never raise. Email is best-effort
in this codebase: a missing verification mail must not break signup.

The DB session is opened locally (SessionLocal) instead of being passed in
because callers are typically FastAPI BackgroundTasks whose request-scoped
session is already closed by the time we run.
"""
from __future__ import annotations

from email.message import EmailMessage

import aiosmtplib
import httpx

from .db import SessionLocal
from .logging import log
from .settings_db import EmailSettings, get_email_settings


def _formatted_from(cfg: EmailSettings) -> str:
    """RFC-5322 From header. Display-name is wrapped in double quotes only
    when it contains characters that would otherwise trip a relay's parser
    (commas, semicolons, parentheses); plain ASCII names go through bare so
    the header stays human-readable."""
    if not cfg.from_name:
        return cfg.from_email
    name = cfg.from_name
    if any(c in name for c in ',;<>()"'):
        name = '"' + name.replace('"', '\\"') + '"'
    return f"{name} <{cfg.from_email}>"


async def _send_smtp(cfg: EmailSettings, to: str, subject: str,
                     body_text: str, body_html: str | None) -> None:
    msg = EmailMessage()
    msg["From"] = _formatted_from(cfg)
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body_text)
    if body_html:
        msg.add_alternative(body_html, subtype="html")
    await aiosmtplib.send(
        msg,
        hostname=cfg.smtp_host,
        port=cfg.smtp_port,
        username=cfg.smtp_user or None,
        password=cfg.smtp_password or None,
        start_tls=cfg.smtp_use_tls,
    )


async def _send_resend(cfg: EmailSettings, to: str, subject: str,
                       body_text: str, body_html: str | None) -> None:
    payload: dict = {
        "from": _formatted_from(cfg),
        "to": [to],
        "subject": subject,
        "text": body_text,
    }
    if body_html:
        payload["html"] = body_html
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            "https://api.resend.com/emails",
            json=payload,
            headers={"Authorization": f"Bearer {cfg.api_key}"},
        )
    r.raise_for_status()


async def _send_postmark(cfg: EmailSettings, to: str, subject: str,
                         body_text: str, body_html: str | None) -> None:
    payload: dict = {
        "From": _formatted_from(cfg),
        "To": to,
        "Subject": subject,
        "TextBody": body_text,
        "MessageStream": "outbound",
    }
    if body_html:
        payload["HtmlBody"] = body_html
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            "https://api.postmarkapp.com/email",
            json=payload,
            headers={
                "Accept": "application/json",
                "X-Postmark-Server-Token": cfg.api_key,
            },
        )
    r.raise_for_status()


async def _send_sendgrid(cfg: EmailSettings, to: str, subject: str,
                         body_text: str, body_html: str | None) -> None:
    contents = [{"type": "text/plain", "value": body_text}]
    if body_html:
        contents.append({"type": "text/html", "value": body_html})
    payload: dict = {
        "personalizations": [{"to": [{"email": to}]}],
        "from": {
            "email": cfg.from_email,
            **({"name": cfg.from_name} if cfg.from_name else {}),
        },
        "subject": subject,
        "content": contents,
    }
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(
            "https://api.sendgrid.com/v3/mail/send",
            json=payload,
            headers={"Authorization": f"Bearer {cfg.api_key}"},
        )
    r.raise_for_status()


async def send_email(to: str, subject: str, body_text: str,
                     body_html: str | None = None) -> None:
    with SessionLocal() as db:
        cfg = get_email_settings(db)

    if cfg.provider == "disabled":
        log.warning("email_disabled_skipped", to=to, subject=subject)
        return
    if not cfg.configured:
        log.warning(
            "email_provider_misconfigured",
            provider=cfg.provider, to=to, subject=subject,
        )
        return

    try:
        if cfg.provider == "smtp":
            await _send_smtp(cfg, to, subject, body_text, body_html)
        elif cfg.provider == "resend":
            await _send_resend(cfg, to, subject, body_text, body_html)
        elif cfg.provider == "postmark":
            await _send_postmark(cfg, to, subject, body_text, body_html)
        elif cfg.provider == "sendgrid":
            await _send_sendgrid(cfg, to, subject, body_text, body_html)
        else:
            log.error("email_unknown_provider", provider=cfg.provider)
            return
    except Exception as e:
        # Best-effort — we never want a stuck mail relay to kill signup.
        log.error(
            "email_send_failed",
            provider=cfg.provider, to=to, subject=subject, error=str(e),
        )
        return
    log.info("email_sent", provider=cfg.provider, to=to, subject=subject)


def render_verification_email(verify_url: str) -> tuple[str, str]:
    text = (
        "ยินดีต้อนรับ!\n\n"
        f"กรุณายืนยันอีเมลโดยคลิกลิงก์ด้านล่าง:\n\n  {verify_url}\n\n"
        "ลิงก์นี้จะหมดอายุภายใน 24 ชั่วโมง\n"
    )
    html = (
        '<p>ยินดีต้อนรับ!</p>'
        f'<p>ยืนยันอีเมลของคุณ: <a href="{verify_url}">{verify_url}</a></p>'
        '<p style="color:#888">ลิงก์นี้จะหมดอายุภายใน 24 ชั่วโมง</p>'
    )
    return text, html


def render_password_reset_email(reset_url: str) -> tuple[str, str]:
    text = (
        "มีคำขอรีเซ็ตรหัสผ่านสำหรับบัญชีของคุณ\n\n"
        "หากคุณเป็นผู้ส่งคำขอ คลิกลิงก์ด้านล่างเพื่อตั้งรหัสผ่านใหม่:\n\n"
        f"  {reset_url}\n\n"
        "ลิงก์นี้จะหมดอายุภายใน 30 นาที หากไม่ใช่คุณ กรุณาเพิกเฉยข้อความนี้\n"
    )
    html = (
        '<p>มีคำขอรีเซ็ตรหัสผ่านสำหรับบัญชีของคุณ</p>'
        f'<p>หากเป็นคุณ: <a href="{reset_url}">ตั้งรหัสผ่านใหม่</a></p>'
        '<p style="color:#888">ลิงก์นี้จะหมดอายุภายใน 30 นาที '
        'หากไม่ใช่คุณ กรุณาเพิกเฉยข้อความนี้</p>'
    )
    return text, html


def render_device_otp_email(code: str, ip: str | None, ua: str | None) -> tuple[str, str]:
    """OTP for confirming a login from a new/suspicious device.

    Includes IP + UA tail so a real owner sees "huh, that's not me" and
    can ignore the code (the challenge expires in 10 min anyway)."""
    ua_tail = (ua or "")[:80]
    text = (
        "มีการเข้าสู่ระบบจากอุปกรณ์ใหม่\n\n"
        f"รหัสยืนยัน 6 หลัก: {code}\n"
        "ใช้ภายใน 10 นาที\n\n"
        f"IP: {ip or '-'}\n"
        f"อุปกรณ์: {ua_tail or '-'}\n\n"
        "หากไม่ใช่คุณ กรุณาเปลี่ยนรหัสผ่านทันที\n"
    )
    html = (
        '<p>มีการเข้าสู่ระบบจากอุปกรณ์ใหม่</p>'
        f'<p style="font-size:24px; letter-spacing:6px"><strong>{code}</strong></p>'
        '<p style="color:#888">ใช้ภายใน 10 นาที</p>'
        f'<p style="color:#888">IP: {ip or "-"}<br>อุปกรณ์: {ua_tail or "-"}</p>'
        '<p style="color:#c00">หากไม่ใช่คุณ กรุณาเปลี่ยนรหัสผ่านทันที</p>'
    )
    return text, html
