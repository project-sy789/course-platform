"""Async SMTP wrapper. Use a real transactional provider (Resend/Postmark/SES)
in production — they handle DKIM/SPF, complaint loops, and bounce processing.

If SMTP_HOST is empty, send_email() logs and is a no-op. This lets dev/test
work without a configured mail relay.
"""
from __future__ import annotations

from email.message import EmailMessage

import aiosmtplib

from .config import settings
from .logging import log


async def send_email(to: str, subject: str, body_text: str, body_html: str | None = None) -> None:
    if not settings.SMTP_HOST:
        log.warning("smtp_disabled_email_skipped", to=to, subject=subject)
        return

    msg = EmailMessage()
    msg["From"] = settings.SMTP_FROM
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body_text)
    if body_html:
        msg.add_alternative(body_html, subtype="html")

    await aiosmtplib.send(
        msg,
        hostname=settings.SMTP_HOST,
        port=settings.SMTP_PORT,
        username=settings.SMTP_USER or None,
        password=settings.SMTP_PASSWORD or None,
        start_tls=settings.SMTP_USE_TLS,
    )
    log.info("email_sent", to=to, subject=subject)


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
